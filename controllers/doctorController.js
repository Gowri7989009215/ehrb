const Record = require('../models/Record');
const Consent = require('../models/Consent');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const blockchain = require('../blockchain');
const { decrypt } = require('../utils/encryption');

/**
 * Request access to patient records
 */
const requestAccess = async (req, res) => {
  try {
    const { patientId, requestMessage, consentType, permissions, allowedCategories, validUntil } = req.body;
    const doctorId = req.user._id;

    // Validate required fields
    if (!patientId || !validUntil) {
      return res.status(400).json({
        success: false,
        message: 'Please provide patientId and validUntil date'
      });
    }

    // Verify patient exists
    const patient = await User.findById(patientId);
    if (!patient || patient.role !== 'patient') {
      return res.status(400).json({
        success: false,
        message: 'Invalid patient ID'
      });
    }

    // Check if request already exists
    let consent = await Consent.findOne({ patientId, doctorId });
    
    if (consent && consent.status === 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Access request already pending'
      });
    }

    if (consent && consent.status === 'granted' && consent.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Access already granted and valid'
      });
    }

    // Create or update consent request
    if (consent) {
      consent.status = 'pending';
      consent.requestMessage = requestMessage || '';
      consent.consentType = consentType || 'limited-access';
      consent.permissions = permissions || { canView: true, canDownload: false };
      consent.allowedCategories = allowedCategories || [];
      consent.validUntil = new Date(validUntil);
      consent.isActive = true;
    } else {
      consent = new Consent({
        patientId,
        doctorId,
        status: 'pending',
        requestMessage: requestMessage || '',
        consentType: consentType || 'limited-access',
        permissions: permissions || { canView: true, canDownload: false },
        allowedCategories: allowedCategories || [],
        validUntil: new Date(validUntil),
        blockchainHash: '' // Will be set after blockchain record
      });
    }

    // Record request on blockchain
    const blockchainRecord = blockchain.recordConsent(
      patientId.toString(),
      doctorId.toString(),
      'REQUESTED',
      consent.validUntil
    );

    consent.blockchainHash = blockchainRecord.hash;
    await consent.save();

    // Log the access request
    await AuditLog.logActivity(
      doctorId,
      'CONSENT_REQUEST',
      `Access requested for patient: ${patient.name}`,
      {
        resourceType: 'consent',
        targetId: consent._id,
        targetModel: 'Consent',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          patientId,
          patientName: patient.name,
          consentType: consent.consentType,
          validUntil: consent.validUntil
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'low',
        status: 'success'
      }
    );

    await consent.populate('patientId', 'name email');

    res.status(201).json({
      success: true,
      message: 'Access request sent successfully',
      data: {
        consent,
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Request access error:', error);
    
    // Provide more specific error messages
    let message = 'Failed to request access';
    let statusCode = 500;
    
    if (error.name === 'ValidationError') {
      message = 'Invalid data provided';
      statusCode = 400;
    } else if (error.name === 'CastError') {
      message = 'Invalid patient ID format';
      statusCode = 400;
    } else if (error.message.includes('ENCRYPTION_KEY')) {
      message = 'Server configuration error';
      statusCode = 500;
    }
    
    res.status(statusCode).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { error: error.message })
    });
  }
};

/**
 * Get patient records (with consent validation)
 */
const getPatientRecords = async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.user._id;
    const { category, limit = 20, skip = 0 } = req.query;

    // Verify consent
    const hasAccess = await Consent.hasAccess(doctorId, patientId, 'view');
    if (!hasAccess) {
      await AuditLog.logActivity(
        doctorId,
        'UNAUTHORIZED_ACCESS',
        `Attempted to access patient records without consent`,
        {
          resourceType: 'record',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            patientId,
            action: 'view'
          },
          severity: 'high',
          status: 'failure'
        }
      );

      return res.status(403).json({
        success: false,
        message: 'No valid consent for accessing this patient data'
      });
    }

    // Get consent details for category filtering
    const consent = await Consent.findOne({
      patientId,
      doctorId,
      status: 'granted',
      validUntil: { $gt: new Date() },
      isActive: true
    });

    let query = { patientId, isActive: true };

    // Apply category restrictions if consent is limited
    if (consent.consentType === 'limited-access' && consent.allowedCategories.length > 0) {
      query.category = { $in: consent.allowedCategories };
    }

    // Apply additional category filter from request
    if (category) {
      if (query.category) {
        query.category = { $in: [category] };
      } else {
        query.category = category;
      }
    }

    const records = await Record.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('uploaderId', 'name role');

    const totalRecords = await Record.countDocuments(query);

    // Log the access
    await AuditLog.logActivity(
      doctorId,
      'RECORD_VIEW',
      `Viewed patient records: ${records.length} records`,
      {
        resourceType: 'record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          patientId,
          recordCount: records.length,
          category
        },
        severity: 'low',
        status: 'success'
      }
    );

    // Record access on blockchain
    blockchain.recordAccess(
      doctorId.toString(),
      patientId.toString(),
      'VIEW'
    );

    // Update consent access history
    await consent.recordAccess('view', null, req.ip, req.get('User-Agent'));

    res.json({
      success: true,
      data: {
        records: records.map(record => record.getSummary()),
        pagination: {
          total: totalRecords,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalRecords > parseInt(skip) + parseInt(limit)
        },
        consentInfo: {
          type: consent.consentType,
          permissions: consent.permissions,
          allowedCategories: consent.allowedCategories,
          validUntil: consent.validUntil
        }
      }
    });

  } catch (error) {
    console.error('Get patient records error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get patient records'
    });
  }
};

/**
 * Get decrypted record content
 */
const getRecordContent = async (req, res) => {
  try {
    const { recordId } = req.params;
    const doctorId = req.user._id;

    const record = await Record.findById(recordId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Record not found'
      });
    }

    // Verify consent
    const hasAccess = await Consent.hasAccess(doctorId, record.patientId, 'view');
    if (!hasAccess) {
      await AuditLog.logActivity(
        doctorId,
        'UNAUTHORIZED_ACCESS',
        `Attempted to access record content without consent`,
        {
          resourceType: 'record',
          targetId: recordId,
          targetModel: 'Record',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            patientId: record.patientId,
            action: 'view'
          },
          severity: 'high',
          status: 'failure'
        }
      );

      return res.status(403).json({
        success: false,
        message: 'No valid consent for accessing this record'
      });
    }

    // Decrypt the content
    const decryptedContent = decrypt(record.encryptedData);

    // Update record access count
    await record.recordAccess();

    // Log the access
    await AuditLog.logActivity(
      doctorId,
      'RECORD_VIEW',
      `Viewed record content: ${record.title}`,
      {
        resourceType: 'record',
        targetId: record._id,
        targetModel: 'Record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          patientId: record.patientId,
          recordTitle: record.title
        },
        severity: 'medium',
        status: 'success'
      }
    );

    // Record access on blockchain
    blockchain.recordAccess(
      doctorId.toString(),
      record.patientId.toString(),
      'VIEW',
      recordId
    );

    res.json({
      success: true,
      data: {
        record: {
          ...record.getSummary(),
          content: decryptedContent
        }
      }
    });

  } catch (error) {
    console.error('Get record content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get record content'
    });
  }
};

/**
 * Add notes or update to a patient record
 */
const addRecordUpdate = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { title, description, content, category, tags } = req.body;
    const doctorId = req.user._id;

    // Validate required fields
    if (!title || !content || !category) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title, content, and category'
      });
    }

    // Verify consent for updates
    const hasAccess = await Consent.hasAccess(doctorId, patientId, 'update');
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No permission to update patient records'
      });
    }

    // Encrypt the content
    const { encrypt, generateHash } = require('../utils/encryption');
    const encryptedData = encrypt(content);
    const originalHash = generateHash(content);

    // Create new record
    const record = new Record({
      patientId,
      uploaderId: doctorId,
      title: title.trim(),
      description: description?.trim() || '',
      fileType: 'text',
      category,
      encryptedData,
      originalHash,
      blockchainHash: '', // Will be set after blockchain record
      metadata: {
        mimeType: 'text/plain',
        fileSize: Buffer.byteLength(content, 'utf8'),
        recordDate: new Date(),
        doctorName: req.user.name,
        isUpdate: true
      },
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });

    // Record upload on blockchain
    const blockchainRecord = blockchain.recordUpload(
      record._id.toString(),
      patientId.toString(),
      doctorId.toString(),
      originalHash
    );

    record.blockchainHash = blockchainRecord.hash;
    await record.save();

    // Log the update
    await AuditLog.logActivity(
      doctorId,
      'RECORD_UPDATE',
      `Added record update: ${title}`,
      {
        resourceType: 'record',
        targetId: record._id,
        targetModel: 'Record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          patientId,
          recordTitle: title,
          category
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'medium',
        status: 'success'
      }
    );

    res.status(201).json({
      success: true,
      message: 'Record update added successfully',
      data: {
        record: record.getSummary(),
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Add record update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add record update'
    });
  }
};

/**
 * Get doctor's active consents
 */
const getActiveConsents = async (req, res) => {
  try {
    const doctorId = req.user._id;
    const { limit = 20, skip = 0 } = req.query;

    const consents = await Consent.findActiveForDoctor(doctorId)
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const totalConsents = await Consent.countDocuments({
      doctorId,
      status: 'granted',
      validUntil: { $gt: new Date() },
      isActive: true
    });

    res.json({
      success: true,
      data: {
        consents,
        pagination: {
          total: totalConsents,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalConsents > parseInt(skip) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get active consents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active consents'
    });
  }
};

/**
 * Get doctor dashboard data
 */
const getDashboard = async (req, res) => {
  try {
    const doctorId = req.user._id;

    // Get statistics
    const activeConsents = await Consent.countDocuments({
      doctorId,
      status: 'granted',
      validUntil: { $gt: new Date() }
    });

    const pendingRequests = await Consent.countDocuments({
      doctorId,
      status: 'pending'
    });

    const expiringSoon = await Consent.countDocuments({
      doctorId,
      status: 'granted',
      validUntil: { 
        $gt: new Date(),
        $lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
      }
    });

    const totalPatients = await Consent.distinct('patientId', {
      doctorId,
      status: 'granted'
    }).then(patients => patients.length);

    // Get patients with active consent
    const patientsWithConsent = await Consent.find({
      doctorId,
      status: 'granted',
      validUntil: { $gt: new Date() }
    })
    .populate('patientId', 'name email')
    .limit(5)
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        statistics: {
          activeConsents,
          pendingRequests,
          expiringSoon,
          totalPatients
        },
        patientsWithConsent
      }
    });

  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard data'
    });
  }
};

/**
 * Get doctor activity log (audit trail)
 */
const getActivityLog = async (req, res) => {
  try {
    const doctorId = req.user._id;
    const { limit = 50, skip = 0, startDate, endDate, actions } = req.query;

    const auditLogs = await AuditLog.getAuditTrail(doctorId, {
      limit: parseInt(limit),
      skip: parseInt(skip),
      startDate,
      endDate,
      actions: actions ? actions.split(',') : undefined
    });

    // Get blockchain audit trail
    const blockchainAudit = blockchain.getAuditTrail(doctorId.toString());

    res.json({
      success: true,
      data: {
        auditLogs,
        blockchainAudit,
        pagination: {
          limit: parseInt(limit),
          skip: parseInt(skip)
        }
      }
    });

  } catch (error) {
    console.error('Get activity log error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get activity log'
    });
  }
};

module.exports = {
  requestAccess,
  getPatientRecords,
  getRecordContent,
  addRecordUpdate,
  getActiveConsents,
  getDashboard,
  getActivityLog
};
