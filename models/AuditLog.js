const mongoose = require('mongoose');

/**
 * Audit Log Schema for tracking all system activities
 */
const auditLogSchema = new mongoose.Schema({
  actorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Allow null for system-generated logs
    index: true
  },
  action: {
    type: String,
    required: [true, 'Action is required'],
    enum: [
      // Authentication actions
      'LOGIN', 'LOGOUT', 'REGISTER', 'PASSWORD_CHANGE',
      // Record actions
      'RECORD_UPLOAD', 'RECORD_VIEW', 'RECORD_DOWNLOAD', 'RECORD_UPDATE', 'RECORD_DELETE',
      // Consent actions
      'CONSENT_REQUEST', 'CONSENT_GRANT', 'CONSENT_REVOKE', 'CONSENT_EXPIRE',
      // User management actions
      'USER_APPROVE', 'USER_REJECT', 'USER_DEACTIVATE', 'USER_ACTIVATE',
      // System actions
      'SYSTEM_BACKUP', 'SYSTEM_RESTORE', 'SYSTEM_MAINTENANCE',
      // Security actions
      'UNAUTHORIZED_ACCESS', 'FAILED_LOGIN', 'SUSPICIOUS_ACTIVITY'
    ]
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'targetModel'
  },
  targetModel: {
    type: String,
    enum: ['User', 'Record', 'Consent']
  },
  resourceType: {
    type: String,
    enum: ['user', 'record', 'consent', 'system'],
    required: [true, 'Resource type is required']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  metadata: {
    // Additional context-specific data
    ipAddress: String,
    userAgent: String,
    sessionId: String,
    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Record'
    },
    consentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consent'
    },
    oldValues: mongoose.Schema.Types.Mixed,
    newValues: mongoose.Schema.Types.Mixed,
    fileSize: Number,
    fileName: String,
    errorMessage: String,
    requestData: mongoose.Schema.Types.Mixed
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['success', 'failure', 'warning'],
    default: 'success'
  },
  blockchainHash: {
    type: String // Hash of the blockchain block that recorded this audit
  },
  tags: [{
    type: String,
    trim: true
  }],
  isSystemGenerated: {
    type: Boolean,
    default: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for better query performance
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ targetId: 1, timestamp: -1 });
auditLogSchema.index({ resourceType: 1, timestamp: -1 });
auditLogSchema.index({ severity: 1, timestamp: -1 });
auditLogSchema.index({ status: 1, timestamp: -1 });

// Static method to log an activity
auditLogSchema.statics.logActivity = async function(actorId, action, description, options = {}) {
  try {
    // Prepare audit log data
    const auditData = {
      action,
      description,
      targetId: options.targetId,
      targetModel: options.targetModel,
      resourceType: options.resourceType || 'system',
      metadata: options.metadata || {},
      severity: options.severity || 'medium',
      status: options.status || 'success',
      blockchainHash: options.blockchainHash,
      tags: options.tags || [],
      isSystemGenerated: options.isSystemGenerated !== false
    };

    // Only add actorId if it's not null/undefined
    if (actorId) {
      auditData.actorId = actorId;
    }

    const auditLog = new this(auditData);
    await auditLog.save();
    return auditLog;
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // Don't throw error to prevent breaking the main flow
    // Just log the error and continue
    return null;
  }
};

// Static method to get audit trail for a user
auditLogSchema.statics.getAuditTrail = function(userId, options = {}) {
  const {
    limit = 50,
    skip = 0,
    startDate,
    endDate,
    actions,
    severity
  } = options;

  let query = {
    $or: [
      { actorId: userId },
      { targetId: userId }
    ]
  };

  // Add date range filter
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = new Date(startDate);
    if (endDate) query.timestamp.$lte = new Date(endDate);
  }

  // Add action filter
  if (actions && actions.length > 0) {
    query.action = { $in: actions };
  }

  // Add severity filter
  if (severity) {
    query.severity = severity;
  }

  return this.find(query)
    .populate('actorId', 'name email role')
    .populate('targetId')
    .sort({ timestamp: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to get system audit logs
auditLogSchema.statics.getSystemAudit = function(options = {}) {
  const {
    limit = 100,
    skip = 0,
    startDate,
    endDate,
    actions,
    severity,
    status
  } = options;

  let query = {};

  // Add date range filter
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = new Date(startDate);
    if (endDate) query.timestamp.$lte = new Date(endDate);
  }

  // Add action filter
  if (actions && actions.length > 0) {
    query.action = { $in: actions };
  }

  // Add severity filter
  if (severity) {
    query.severity = severity;
  }

  // Add status filter
  if (status) {
    query.status = status;
  }

  return this.find(query)
    .populate('actorId', 'name email role')
    .populate('targetId')
    .sort({ timestamp: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to get security alerts
auditLogSchema.statics.getSecurityAlerts = function(options = {}) {
  const {
    limit = 20,
    skip = 0,
    startDate
  } = options;

  let query = {
    $or: [
      { action: 'UNAUTHORIZED_ACCESS' },
      { action: 'FAILED_LOGIN' },
      { action: 'SUSPICIOUS_ACTIVITY' },
      { severity: 'critical' },
      { severity: 'high' }
    ]
  };

  // Add date range filter (default to last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  query.timestamp = {
    $gte: startDate ? new Date(startDate) : thirtyDaysAgo
  };

  return this.find(query)
    .populate('actorId', 'name email role')
    .populate('targetId')
    .sort({ timestamp: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to get activity statistics
auditLogSchema.statics.getActivityStats = async function(options = {}) {
  const {
    startDate,
    endDate,
    groupBy = 'day' // day, week, month
  } = options;

  // Default to last 30 days if no date range provided
  const defaultEndDate = new Date();
  const defaultStartDate = new Date();
  defaultStartDate.setDate(defaultStartDate.getDate() - 30);

  const matchStage = {
    timestamp: {
      $gte: startDate ? new Date(startDate) : defaultStartDate,
      $lte: endDate ? new Date(endDate) : defaultEndDate
    }
  };

  let dateGrouping;
  switch (groupBy) {
    case 'week':
      dateGrouping = { $week: '$timestamp' };
      break;
    case 'month':
      dateGrouping = { $month: '$timestamp' };
      break;
    default: // day
      dateGrouping = { $dayOfYear: '$timestamp' };
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: {
          date: dateGrouping,
          year: { $year: '$timestamp' },
          action: '$action'
        },
        count: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: {
          date: '$_id.date',
          year: '$_id.year'
        },
        actions: {
          $push: {
            action: '$_id.action',
            count: '$count'
          }
        },
        totalCount: { $sum: '$count' }
      }
    },
    { $sort: { '_id.year': 1, '_id.date': 1 } }
  ];

  return this.aggregate(pipeline);
};

// Virtual for formatted timestamp
auditLogSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp.toISOString();
});

// Ensure virtual fields are serialized
auditLogSchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
