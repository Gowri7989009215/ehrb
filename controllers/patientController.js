const Record = require('../models/Record');
const Consent = require('../models/Consent');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const blockchain = require('../blockchain');
const { encrypt, generateHash } = require('../utils/encryption');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and documents are allowed.'));
    }
  }
});

/**
 * Upload encrypted medical record
 */
const uploadRecord = async (req, res) => {
  try {
    const { title, description, fileType, category, tags, metadata } = req.body;
    const patientId = req.user._id;

    // Validate required fields
    if (!title || !fileType || !category) {
      return res.status(400).json({
        success: false,
        message: 'Please provide title, fileType, and category'
      });
    }

    let fileData;
    let originalFileName = '';
    let fileSize = 0;
    let mimeType = '';

    // Handle file upload or text data
    if (req.file) {
      fileData = req.file.buffer.toString('base64');
      originalFileName = req.file.originalname;
      fileSize = req.file.size;
      mimeType = req.file.mimetype;
    } else if (req.body.textData) {
      fileData = req.body.textData;
      mimeType = 'text/plain';
      fileSize = Buffer.byteLength(fileData, 'utf8');
    } else {
      return res.status(400).json({
        success: false,
        message: 'Please provide either a file or text data'
      });
    }

    // Encrypt the data
    const encryptedData = encrypt(fileData);
    const originalHash = generateHash(fileData);

    // Create record
    const record = new Record({
      patientId,
      uploaderId: patientId,
      title: title.trim(),
      description: description?.trim() || '',
      fileType,
      category,
      encryptedData,
      originalHash,
      blockchainHash: '', // Will be set after blockchain record
      metadata: {
        originalFileName,
        fileSize,
        mimeType,
        recordDate: new Date(),
        ...metadata
      },
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });

    // Record upload on blockchain
    const blockchainRecord = blockchain.recordUpload(
      record._id.toString(),
      patientId.toString(),
      patientId.toString(),
      originalHash
    );

    record.blockchainHash = blockchainRecord.hash;
    await record.save();

    // Log the upload
    await AuditLog.logActivity(
      patientId,
      'RECORD_UPLOAD',
      `Medical record uploaded: ${title}`,
      {
        resourceType: 'record',
        targetId: record._id,
        targetModel: 'Record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          fileName: originalFileName,
          fileSize,
          category,
          fileType
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'low',
        status: 'success'
      }
    );

    res.status(201).json({
      success: true,
      message: 'Record uploaded successfully',
      data: {
        record: record.getSummary(),
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Upload record error:', error);
    
    await AuditLog.logActivity(
      req.user._id,
      'RECORD_UPLOAD',
      `Failed to upload record: ${error.message}`,
      {
        resourceType: 'record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          errorMessage: error.message
        },
        severity: 'medium',
        status: 'failure'
      }
    );

    res.status(500).json({
      success: false,
      message: 'Failed to upload record'
    });
  }
};

/**
 * Get patient's medical records
 */
const getRecords = async (req, res) => {
  try {
    const patientId = req.user._id;
    const { category, limit = 20, skip = 0 } = req.query;

    let query = { patientId, isActive: true };
    if (category) {
      query.category = category;
    }

    const records = await Record.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .populate('uploaderId', 'name role');

    const totalRecords = await Record.countDocuments(query);

    res.json({
      success: true,
      data: {
        records: records.map(record => record.getSummary()),
        pagination: {
          total: totalRecords,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalRecords > parseInt(skip) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get records'
    });
  }
};

/**
 * Get patient profile
 */
const getProfile = async (req, res) => {
  try {
    const patientId = req.user._id;
    
    const patient = await User.findById(patientId).select('-password');
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    res.json({
      success: true,
      data: {
        profile: patient
      }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
};

/**
 * Update patient profile
 */
const updateProfile = async (req, res) => {
  try {
    const patientId = req.user._id;
    const { name, profileData } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (profileData) updateData.profileData = { ...req.user.profileData, ...profileData };

    const updatedPatient = await User.findByIdAndUpdate(
      patientId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedPatient) {
      return res.status(404).json({
        success: false,
        message: 'Patient not found'
      });
    }

    // Log the profile update
    await AuditLog.logActivity(
      patientId,
      'PROFILE_UPDATE',
      'Updated profile information',
      {
        resourceType: 'user',
        targetId: patientId,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          updatedFields: Object.keys(updateData)
        },
        severity: 'low',
        status: 'success'
      }
    );

    res.json({
      success: true,
      data: {
        profile: updatedPatient
      },
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
};

/**
 * Get decrypted record content (for patient's own records)
 */
const getRecordContent = async (req, res) => {
  try {
    const { recordId } = req.params;
    const patientId = req.user._id;

    const record = await Record.findById(recordId);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Record not found'
      });
    }

    // Verify the record belongs to the patient
    if (record.patientId.toString() !== patientId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Decrypt the content
    const { decrypt } = require('../utils/encryption');
    const decryptedContent = decrypt(record.encryptedData);

    // Update record access count
    await record.recordAccess();

    // Log the access
    await AuditLog.logActivity(
      patientId,
      'RECORD_VIEW',
      `Viewed own record: ${record.title}`,
      {
        resourceType: 'record',
        targetId: record._id,
        targetModel: 'Record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          recordTitle: record.title
        },
        severity: 'low',
        status: 'success'
      }
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
 * Grant consent to a doctor
 */
const grantConsent = async (req, res) => {
  try {
    const { doctorId, consentType, permissions, allowedCategories, validUntil, responseMessage } = req.body;
    const patientId = req.user._id;

    // Validate required fields
    if (!doctorId || !validUntil) {
      return res.status(400).json({
        success: false,
        message: 'Please provide doctorId and validUntil date'
      });
    }

    // Verify doctor exists and is approved
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor' || !doctor.approved) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or unapproved doctor'
      });
    }

    // Check if consent already exists
    let consent = await Consent.findOne({ patientId, doctorId });
    
    if (consent) {
      // Update existing consent
      consent.status = 'granted';
      consent.consentType = consentType || 'limited-access';
      consent.permissions = permissions || { canView: true, canDownload: false };
      consent.allowedCategories = allowedCategories || [];
      consent.validUntil = new Date(validUntil);
      consent.responseMessage = responseMessage || '';
      consent.isActive = true;
    } else {
      // Create new consent
      consent = new Consent({
        patientId,
        doctorId,
        status: 'granted',
        consentType: consentType || 'limited-access',
        permissions: permissions || { canView: true, canDownload: false },
        allowedCategories: allowedCategories || [],
        validUntil: new Date(validUntil),
        responseMessage: responseMessage || '',
        blockchainHash: '' // Will be set after blockchain record
      });
    }

    // Record consent on blockchain
    const blockchainRecord = blockchain.recordConsent(
      patientId.toString(),
      doctorId.toString(),
      'GRANTED',
      consent.validUntil
    );

    consent.blockchainHash = blockchainRecord.hash;
    await consent.save();

    // Log the consent grant
    await AuditLog.logActivity(
      patientId,
      'CONSENT_GRANT',
      `Consent granted to Dr. ${doctor.name}`,
      {
        resourceType: 'consent',
        targetId: consent._id,
        targetModel: 'Consent',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          doctorId,
          doctorName: doctor.name,
          consentType: consent.consentType,
          validUntil: consent.validUntil
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'medium',
        status: 'success'
      }
    );

    await consent.populate('doctorId', 'name email profileData.specialization');

    res.json({
      success: true,
      message: 'Consent granted successfully',
      data: {
        consent,
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Grant consent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to grant consent'
    });
  }
};

/**
 * Revoke consent from a doctor
 */
const revokeConsent = async (req, res) => {
  try {
    const { doctorId, responseMessage } = req.body;
    const patientId = req.user._id;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide doctorId'
      });
    }

    const consent = await Consent.findOne({ patientId, doctorId, isActive: true });
    
    if (!consent) {
      return res.status(404).json({
        success: false,
        message: 'Consent not found'
      });
    }

    // Revoke consent
    await consent.revoke(responseMessage);

    // Record revocation on blockchain
    const blockchainRecord = blockchain.recordConsent(
      patientId.toString(),
      doctorId.toString(),
      'REVOKED'
    );

    // Log the consent revocation
    const doctor = await User.findById(doctorId);
    await AuditLog.logActivity(
      patientId,
      'CONSENT_REVOKE',
      `Consent revoked from Dr. ${doctor?.name || 'Unknown'}`,
      {
        resourceType: 'consent',
        targetId: consent._id,
        targetModel: 'Consent',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          doctorId,
          doctorName: doctor?.name
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'Consent revoked successfully',
      data: {
        consent,
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Revoke consent error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to revoke consent'
    });
  }
};

/**
 * Get patient's consent history
 */
const getConsents = async (req, res) => {
  try {
    const patientId = req.user._id;
    const { status, limit = 20, skip = 0 } = req.query;

    let query = { patientId, isActive: true };
    if (status) {
      query.status = status;
    }

    const consents = await Consent.find(query)
      .populate('doctorId', 'name email profileData.specialization')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const totalConsents = await Consent.countDocuments(query);

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
    console.error('Get consents error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get consents'
    });
  }
};

/**
 * Get patient's audit trail
 */
const getAuditTrail = async (req, res) => {
  try {
    const patientId = req.user._id;
    const { limit = 50, skip = 0, startDate, endDate, actions } = req.query;

    const auditLogs = await AuditLog.getAuditTrail(patientId, {
      limit: parseInt(limit),
      skip: parseInt(skip),
      startDate,
      endDate,
      actions: actions ? actions.split(',') : undefined
    });

    // Get blockchain audit trail
    const blockchainAudit = blockchain.getAuditTrail(patientId.toString());

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
    console.error('Get audit trail error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get audit trail'
    });
  }
};

/**
 * Get dashboard statistics
 */
const getDashboard = async (req, res) => {
  try {
    const patientId = req.user._id;

    // Get record statistics
    const totalRecords = await Record.countDocuments({ patientId, isActive: true });
    const recordsByCategory = await Record.aggregate([
      { $match: { patientId: patientId, isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Get consent statistics
    const activeConsents = await Consent.countDocuments({ 
      patientId, 
      status: 'granted', 
      validUntil: { $gt: new Date() },
      isActive: true 
    });
    
    const pendingRequests = await Consent.countDocuments({ 
      patientId, 
      status: 'pending',
      isActive: true 
    });

    // Get recent activity
    const recentActivity = await AuditLog.getAuditTrail(patientId, {
      limit: 10
    });

    res.json({
      success: true,
      data: {
        statistics: {
          totalRecords,
          activeConsents,
          pendingRequests,
          recordsByCategory
        },
        recentActivity
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

module.exports = {
  uploadRecord: [upload.single('file'), uploadRecord],
  getRecords,
  getRecordContent,
  getProfile,
  updateProfile,
  grantConsent,
  revokeConsent,
  getConsents,
  getAuditTrail,
  getDashboard
};
