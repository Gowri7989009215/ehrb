const Record = require('../models/Record');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
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
 * Add a doctor to the hospital
 */
const addDoctor = async (req, res) => {
  try {
    const { doctorId } = req.body;
    const hospitalId = req.user._id;

    if (!doctorId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide doctorId'
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

    // Check if doctor is already associated with another hospital
    if (doctor.profileData.hospitalId && doctor.profileData.hospitalId.toString() !== hospitalId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Doctor is already associated with another hospital'
      });
    }

    // Associate doctor with hospital
    doctor.profileData.hospitalId = hospitalId;
    await doctor.save();

    // Log the association
    await AuditLog.logActivity(
      hospitalId,
      'USER_UPDATE',
      `Doctor added to hospital: Dr. ${doctor.name}`,
      {
        resourceType: 'user',
        targetId: doctor._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          doctorId,
          doctorName: doctor.name,
          hospitalId
        },
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'Doctor added to hospital successfully',
      data: {
        doctor: doctor.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Add doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add doctor'
    });
  }
};

/**
 * Remove a doctor from the hospital
 */
const removeDoctor = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const hospitalId = req.user._id;

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found'
      });
    }

    // Check if doctor belongs to this hospital
    if (!doctor.profileData.hospitalId || doctor.profileData.hospitalId.toString() !== hospitalId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Doctor is not associated with this hospital'
      });
    }

    // Remove association
    doctor.profileData.hospitalId = undefined;
    await doctor.save();

    // Log the removal
    await AuditLog.logActivity(
      hospitalId,
      'USER_UPDATE',
      `Doctor removed from hospital: Dr. ${doctor.name}`,
      {
        resourceType: 'user',
        targetId: doctor._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          doctorId,
          doctorName: doctor.name,
          hospitalId
        },
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'Doctor removed from hospital successfully'
    });

  } catch (error) {
    console.error('Remove doctor error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove doctor'
    });
  }
};

/**
 * Get hospital's doctors
 */
const getDoctors = async (req, res) => {
  try {
    const hospitalId = req.user._id;
    const { limit = 20, skip = 0 } = req.query;

    const doctors = await User.find({
      role: 'doctor',
      'profileData.hospitalId': hospitalId,
      isActive: true
    })
    .select('-password')
    .sort({ name: 1 })
    .limit(parseInt(limit))
    .skip(parseInt(skip));

    const totalDoctors = await User.countDocuments({
      role: 'doctor',
      'profileData.hospitalId': hospitalId,
      isActive: true
    });

    res.json({
      success: true,
      data: {
        doctors,
        pagination: {
          total: totalDoctors,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalDoctors > parseInt(skip) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get doctors'
    });
  }
};

/**
 * Store patient record (lab results, discharge summary, etc.)
 */
const storeRecord = async (req, res) => {
  try {
    const { patientId, title, description, fileType, category, tags, metadata } = req.body;
    const hospitalId = req.user._id;

    // Validate required fields
    if (!patientId || !title || !fileType || !category) {
      return res.status(400).json({
        success: false,
        message: 'Please provide patientId, title, fileType, and category'
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
      uploaderId: hospitalId,
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
        hospitalName: req.user.name,
        ...metadata
      },
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });

    // Record upload on blockchain
    const blockchainRecord = blockchain.recordUpload(
      record._id.toString(),
      patientId.toString(),
      hospitalId.toString(),
      originalHash
    );

    record.blockchainHash = blockchainRecord.hash;
    await record.save();

    // Log the upload
    await AuditLog.logActivity(
      hospitalId,
      'RECORD_UPLOAD',
      `Hospital record stored: ${title} for patient ${patient.name}`,
      {
        resourceType: 'record',
        targetId: record._id,
        targetModel: 'Record',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          patientId,
          patientName: patient.name,
          fileName: originalFileName,
          fileSize,
          category,
          fileType
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'medium',
        status: 'success'
      }
    );

    res.status(201).json({
      success: true,
      message: 'Record stored successfully',
      data: {
        record: record.getSummary(),
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Store record error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to store record'
    });
  }
};

/**
 * Get hospital's stored records
 */
const getStoredRecords = async (req, res) => {
  try {
    const hospitalId = req.user._id;
    const { patientId, category, limit = 20, skip = 0 } = req.query;

    let query = { uploaderId: hospitalId, isActive: true };
    if (patientId) {
      query.patientId = patientId;
    }
    if (category) {
      query.category = category;
    }

    const records = await Record.find(query)
      .populate('patientId', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

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
    console.error('Get stored records error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stored records'
    });
  }
};

/**
 * Search for patients
 */
const searchPatients = async (req, res) => {
  try {
    const { query, limit = 20, skip = 0 } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters long'
      });
    }

    const searchRegex = new RegExp(query, 'i');
    const patients = await User.find({
      role: 'patient',
      isActive: true,
      $or: [
        { name: searchRegex },
        { email: searchRegex }
      ]
    })
    .select('name email profileData.dateOfBirth profileData.phone')
    .sort({ name: 1 })
    .limit(parseInt(limit))
    .skip(parseInt(skip));

    const totalPatients = await User.countDocuments({
      role: 'patient',
      isActive: true,
      $or: [
        { name: searchRegex },
        { email: searchRegex }
      ]
    });

    res.json({
      success: true,
      data: {
        patients,
        pagination: {
          total: totalPatients,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalPatients > parseInt(skip) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Search patients error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search patients'
    });
  }
};

/**
 * Get hospital dashboard data
 */
const getDashboard = async (req, res) => {
  try {
    const hospitalId = req.user._id;

    // Get doctor statistics
    const totalDoctors = await User.countDocuments({
      role: 'doctor',
      'profileData.hospitalId': hospitalId,
      isActive: true
    });

    const approvedDoctors = await User.countDocuments({
      role: 'doctor',
      'profileData.hospitalId': hospitalId,
      approved: true,
      isActive: true
    });

    // Get record statistics
    const totalRecords = await Record.countDocuments({
      uploaderId: hospitalId,
      isActive: true
    });

    const recordsByCategory = await Record.aggregate([
      { $match: { uploaderId: hospitalId, isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Get recent activity
    const recentActivity = await AuditLog.getAuditTrail(hospitalId, {
      limit: 10
    });

    // Get recent records
    const recentRecords = await Record.find({
      uploaderId: hospitalId,
      isActive: true
    })
    .populate('patientId', 'name email')
    .sort({ createdAt: -1 })
    .limit(5);

    res.json({
      success: true,
      data: {
        statistics: {
          totalDoctors,
          approvedDoctors,
          totalRecords,
          recordsByCategory
        },
        recentActivity,
        recentRecords: recentRecords.map(record => record.getSummary())
      }
    });

  } catch (error) {
    console.error('Get hospital dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard data'
    });
  }
};

module.exports = {
  addDoctor,
  removeDoctor,
  getDoctors,
  storeRecord: [upload.single('file'), storeRecord],
  getStoredRecords,
  searchPatients,
  getDashboard
};
