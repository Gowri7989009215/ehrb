const mongoose = require('mongoose');

/**
 * Medical Record Schema for storing encrypted health records
 */
const recordSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Patient ID is required'],
    index: true
  },
  uploaderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Uploader ID is required']
  },
  title: {
    type: String,
    required: [true, 'Record title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  fileType: {
    type: String,
    required: [true, 'File type is required'],
    enum: ['pdf', 'image', 'text', 'lab-report', 'prescription', 'diagnosis', 'discharge-summary', 'other']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['general', 'cardiology', 'neurology', 'orthopedics', 'dermatology', 'pediatrics', 'gynecology', 'psychiatry', 'emergency', 'lab-results', 'radiology', 'other']
  },
  encryptedData: {
    encrypted: {
      type: String,
      required: true
    },
    iv: {
      type: String,
      required: true
    },
    authTag: {
      type: String,
      required: true
    }
  },
  originalHash: {
    type: String,
    required: [true, 'Original data hash is required']
  },
  blockchainHash: {
    type: String, // Hash of the blockchain block that recorded this upload
    required: true
  },
  metadata: {
    originalFileName: String,
    fileSize: Number,
    mimeType: String,
    recordDate: {
      type: Date,
      default: Date.now
    },
    hospitalName: String,
    doctorName: String,
    testResults: [{
      testName: String,
      value: String,
      unit: String,
      normalRange: String,
      status: {
        type: String,
        enum: ['normal', 'abnormal', 'critical']
      }
    }]
  },
  tags: [{
    type: String,
    trim: true
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  accessCount: {
    type: Number,
    default: 0
  },
  lastAccessed: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for better query performance
recordSchema.index({ patientId: 1, createdAt: -1 });
recordSchema.index({ uploaderId: 1, createdAt: -1 });
recordSchema.index({ category: 1, fileType: 1 });
recordSchema.index({ tags: 1 });

// Update the updatedAt field before saving
recordSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Instance method to increment access count
recordSchema.methods.recordAccess = function() {
  this.accessCount += 1;
  this.lastAccessed = new Date();
  return this.save();
};

// Instance method to get record summary (without encrypted data)
recordSchema.methods.getSummary = function() {
  const recordObject = this.toObject();
  delete recordObject.encryptedData;
  return recordObject;
};

// Static method to find records by patient
recordSchema.statics.findByPatient = function(patientId, includeInactive = false) {
  const query = { patientId };
  if (!includeInactive) {
    query.isActive = true;
  }
  return this.find(query).sort({ createdAt: -1 });
};

// Static method to find records by category
recordSchema.statics.findByCategory = function(category, patientId = null) {
  const query = { category, isActive: true };
  if (patientId) {
    query.patientId = patientId;
  }
  return this.find(query).sort({ createdAt: -1 });
};

// Static method to search records by tags
recordSchema.statics.searchByTags = function(tags, patientId = null) {
  const query = { 
    tags: { $in: tags },
    isActive: true 
  };
  if (patientId) {
    query.patientId = patientId;
  }
  return this.find(query).sort({ createdAt: -1 });
};

// Virtual for record age
recordSchema.virtual('ageInDays').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Ensure virtual fields are serialized
recordSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    // Don't expose encrypted data in JSON by default
    if (ret.encryptedData && !ret._includeEncrypted) {
      delete ret.encryptedData;
    }
    return ret;
  }
});

module.exports = mongoose.model('Record', recordSchema);
