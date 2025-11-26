const mongoose = require('mongoose');

/**
 * Consent Schema for managing patient consent to doctors
 */
const consentSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Patient ID is required'],
    index: true
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Doctor ID is required'],
    index: true
  },
  status: {
    type: String,
    required: [true, 'Consent status is required'],
    enum: ['pending', 'granted', 'revoked', 'expired'],
    default: 'pending'
  },
  consentType: {
    type: String,
    required: [true, 'Consent type is required'],
    enum: ['full-access', 'limited-access', 'emergency-only', 'specific-records'],
    default: 'limited-access'
  },
  permissions: {
    canView: {
      type: Boolean,
      default: true
    },
    canDownload: {
      type: Boolean,
      default: false
    },
    canUpdate: {
      type: Boolean,
      default: false
    },
    canShare: {
      type: Boolean,
      default: false
    }
  },
  allowedCategories: [{
    type: String,
    enum: ['general', 'cardiology', 'neurology', 'orthopedics', 'dermatology', 'pediatrics', 'gynecology', 'psychiatry', 'emergency', 'lab-results', 'radiology', 'other']
  }],
  specificRecords: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Record'
  }],
  requestMessage: {
    type: String,
    trim: true,
    maxlength: [500, 'Request message cannot exceed 500 characters']
  },
  responseMessage: {
    type: String,
    trim: true,
    maxlength: [500, 'Response message cannot exceed 500 characters']
  },
  validFrom: {
    type: Date,
    default: Date.now
  },
  validUntil: {
    type: Date,
    required: [true, 'Consent expiry date is required'],
    validate: {
      validator: function(value) {
        return value > this.validFrom;
      },
      message: 'Expiry date must be after the valid from date'
    }
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  renewalPeriod: {
    type: Number, // in days
    default: 30
  },
  emergencyAccess: {
    type: Boolean,
    default: false
  },
  blockchainHash: {
    type: String, // Hash of the blockchain block that recorded this consent
    required: true
  },
  accessHistory: [{
    accessedAt: {
      type: Date,
      default: Date.now
    },
    action: {
      type: String,
      enum: ['view', 'download', 'update', 'share']
    },
    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Record'
    },
    ipAddress: String,
    userAgent: String
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  grantedAt: Date,
  revokedAt: Date,
  expiredAt: Date
});

// Compound indexes for better query performance
consentSchema.index({ patientId: 1, doctorId: 1 }, { unique: true });
consentSchema.index({ doctorId: 1, status: 1 });
consentSchema.index({ validUntil: 1, status: 1 });
consentSchema.index({ status: 1, createdAt: -1 });

// Update the updatedAt field before saving
consentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Set status-specific timestamps
  if (this.isModified('status')) {
    const now = new Date();
    switch (this.status) {
      case 'granted':
        this.grantedAt = now;
        break;
      case 'revoked':
        this.revokedAt = now;
        break;
      case 'expired':
        this.expiredAt = now;
        break;
    }
  }
  
  next();
});

// Virtual to check if consent is currently valid
consentSchema.virtual('isValid').get(function() {
  const now = new Date();
  return this.status === 'granted' && 
         this.validFrom <= now && 
         this.validUntil > now &&
         this.isActive;
});

// Virtual to check if consent is expired
consentSchema.virtual('isExpired').get(function() {
  return new Date() > this.validUntil;
});

// Virtual for remaining days
consentSchema.virtual('remainingDays').get(function() {
  const now = new Date();
  const diffTime = this.validUntil - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Instance method to grant consent
consentSchema.methods.grant = function(responseMessage = '') {
  this.status = 'granted';
  this.responseMessage = responseMessage;
  this.grantedAt = new Date();
  return this.save();
};

// Instance method to revoke consent
consentSchema.methods.revoke = function(responseMessage = '') {
  this.status = 'revoked';
  this.responseMessage = responseMessage;
  this.revokedAt = new Date();
  return this.save();
};

// Instance method to record access
consentSchema.methods.recordAccess = function(action, recordId = null, ipAddress = '', userAgent = '') {
  this.accessHistory.push({
    action,
    recordId,
    ipAddress,
    userAgent,
    accessedAt: new Date()
  });
  return this.save();
};

// Instance method to extend validity
consentSchema.methods.extend = function(days) {
  const currentExpiry = new Date(this.validUntil);
  currentExpiry.setDate(currentExpiry.getDate() + days);
  this.validUntil = currentExpiry;
  return this.save();
};

// Static method to find active consents for a doctor
consentSchema.statics.findActiveForDoctor = function(doctorId) {
  const now = new Date();
  return this.find({
    doctorId,
    status: 'granted',
    validFrom: { $lte: now },
    validUntil: { $gt: now },
    isActive: true
  }).populate('patientId', 'name email');
};

// Static method to find active consents for a patient
consentSchema.statics.findActiveForPatient = function(patientId) {
  const now = new Date();
  return this.find({
    patientId,
    status: 'granted',
    validFrom: { $lte: now },
    validUntil: { $gt: now },
    isActive: true
  }).populate('doctorId', 'name email profileData.specialization');
};

// Static method to find pending consent requests
consentSchema.statics.findPendingRequests = function(patientId = null) {
  const query = { 
    status: 'pending',
    isActive: true 
  };
  if (patientId) {
    query.patientId = patientId;
  }
  return this.find(query)
    .populate('doctorId', 'name email profileData.specialization')
    .populate('patientId', 'name email')
    .sort({ createdAt: -1 });
};

// Static method to check if doctor has access to patient
consentSchema.statics.hasAccess = async function(doctorId, patientId, action = 'view') {
  const now = new Date();
  const consent = await this.findOne({
    doctorId,
    patientId,
    status: 'granted',
    validFrom: { $lte: now },
    validUntil: { $gt: now },
    isActive: true
  });

  if (!consent) return false;

  // Check specific permissions
  switch (action) {
    case 'view':
      return consent.permissions.canView;
    case 'download':
      return consent.permissions.canDownload;
    case 'update':
      return consent.permissions.canUpdate;
    case 'share':
      return consent.permissions.canShare;
    default:
      return false;
  }
};

// Ensure virtual fields are serialized
consentSchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('Consent', consentSchema);
