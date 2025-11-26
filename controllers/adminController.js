const User = require('../models/User');
const Record = require('../models/Record');
const Consent = require('../models/Consent');
const AuditLog = require('../models/AuditLog');
const blockchain = require('../blockchain');

/**
 * Get pending user approvals
 */
const getPendingUsers = async (req, res) => {
  try {
    const { role, limit = 20, skip = 0 } = req.query;

    let query = { 
      approved: false, 
      isActive: true,
      role: { $in: ['doctor', 'hospital'] }
    };

    if (role && ['doctor', 'hospital'].includes(role)) {
      query.role = role;
    }

    const pendingUsers = await User.find(query)
      .select('-password')
      .sort({ createdAt: 1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const totalPending = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        pendingUsers,
        pagination: {
          total: totalPending,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalPending > parseInt(skip) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending users'
    });
  }
};

/**
 * Approve a user (doctor or hospital)
 */
const approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { notes } = req.body;
    const adminId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!['doctor', 'hospital'].includes(user.role)) {
      return res.status(400).json({
        success: false,
        message: 'Only doctors and hospitals require approval'
      });
    }

    if (user.approved) {
      return res.status(400).json({
        success: false,
        message: 'User is already approved'
      });
    }

    // Approve the user
    user.approved = true;
    await user.save();

    // Record approval on blockchain
    const blockchainRecord = blockchain.recordVerification(
      userId,
      adminId.toString(),
      'APPROVED'
    );

    // Log the approval
    await AuditLog.logActivity(
      adminId,
      'USER_APPROVE',
      `${user.role} approved: ${user.name}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          approvedUserRole: user.role,
          approvedUserName: user.name,
          approvedUserEmail: user.email,
          notes: notes || ''
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: `${user.role} approved successfully`,
      data: {
        user: user.getPublicProfile(),
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve user'
    });
  }
};

/**
 * Reject a user (doctor or hospital)
 */
const rejectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;
    const adminId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!['doctor', 'hospital'].includes(user.role)) {
      return res.status(400).json({
        success: false,
        message: 'Only doctors and hospitals require approval'
      });
    }

    // Deactivate the user instead of deleting
    user.isActive = false;
    await user.save();

    // Record rejection on blockchain
    const blockchainRecord = blockchain.recordVerification(
      userId,
      adminId.toString(),
      'REJECTED'
    );

    // Log the rejection
    await AuditLog.logActivity(
      adminId,
      'USER_REJECT',
      `${user.role} rejected: ${user.name}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          rejectedUserRole: user.role,
          rejectedUserName: user.name,
          rejectedUserEmail: user.email,
          reason: reason || 'No reason provided'
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: `${user.role} rejected successfully`,
      data: {
        blockchainHash: blockchainRecord.hash
      }
    });

  } catch (error) {
    console.error('Reject user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject user'
    });
  }
};

/**
 * Get all users with filtering
 */
const getAllUsers = async (req, res) => {
  try {
    const { role, approved, isActive, limit = 20, skip = 0, search } = req.query;

    let query = {};

    if (role) {
      query.role = role;
    }

    if (approved !== undefined) {
      query.approved = approved === 'true';
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex }
      ];
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const totalUsers = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          total: totalUsers,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: totalUsers > parseInt(skip) + parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users'
    });
  }
};

/**
 * Deactivate/Activate a user
 */
const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate admin users'
      });
    }

    // Toggle user status
    const newStatus = !user.isActive;
    user.isActive = newStatus;
    await user.save();

    const action = newStatus ? 'USER_ACTIVATE' : 'USER_DEACTIVATE';
    const message = newStatus ? 'activated' : 'deactivated';

    // Log the status change
    await AuditLog.logActivity(
      adminId,
      action,
      `User ${message}: ${user.name}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          targetUserRole: user.role,
          targetUserName: user.name,
          targetUserEmail: user.email,
          newStatus
        },
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: `User ${message} successfully`,
      data: {
        user: user.getPublicProfile()
      }
    });

  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
};

/**
 * Get system audit logs
 */
const getSystemAudit = async (req, res) => {
  try {
    const { 
      limit = 50, 
      skip = 0, 
      startDate, 
      endDate, 
      actions, 
      severity, 
      status,
      userId 
    } = req.query;

    const auditLogs = await AuditLog.getSystemAudit({
      limit: parseInt(limit),
      skip: parseInt(skip),
      startDate,
      endDate,
      actions: actions ? actions.split(',') : undefined,
      severity,
      status
    });

    // If userId is provided, get specific user audit
    let userAudit = [];
    if (userId) {
      userAudit = await AuditLog.getAuditTrail(userId, {
        limit: parseInt(limit),
        skip: parseInt(skip),
        startDate,
        endDate,
        actions: actions ? actions.split(',') : undefined,
        severity
      });
    }

    res.json({
      success: true,
      data: {
        systemAudit: auditLogs,
        userAudit,
        pagination: {
          limit: parseInt(limit),
          skip: parseInt(skip)
        }
      }
    });

  } catch (error) {
    console.error('Get system audit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system audit'
    });
  }
};

/**
 * Get security alerts
 */
const getSecurityAlerts = async (req, res) => {
  try {
    const { limit = 20, skip = 0, startDate } = req.query;

    const securityAlerts = await AuditLog.getSecurityAlerts({
      limit: parseInt(limit),
      skip: parseInt(skip),
      startDate
    });

    res.json({
      success: true,
      data: {
        securityAlerts,
        pagination: {
          limit: parseInt(limit),
          skip: parseInt(skip)
        }
      }
    });

  } catch (error) {
    console.error('Get security alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get security alerts'
    });
  }
};

/**
 * Get system statistics
 */
const getSystemStats = async (req, res) => {
  try {
    // User statistics
    const userStats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
          approved: { $sum: { $cond: ['$approved', 1, 0] } }
        }
      }
    ]);

    // Record statistics
    const totalRecords = await Record.countDocuments({ isActive: true });
    const recordsByCategory = await Record.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Consent statistics
    const consentStats = await Consent.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Activity statistics
    const activityStats = await AuditLog.getActivityStats();

    // Blockchain statistics
    const blockchainStats = blockchain.getStats();

    // Recent registrations
    const recentRegistrations = await User.find({ isActive: true })
      .select('name email role createdAt approved')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        userStats,
        recordStats: {
          total: totalRecords,
          byCategory: recordsByCategory
        },
        consentStats,
        activityStats,
        blockchainStats,
        recentRegistrations
      }
    });

  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get system statistics'
    });
  }
};

/**
 * Get blockchain audit trail
 */
const getBlockchainAudit = async (req, res) => {
  try {
    const { userId, type, limit = 50 } = req.query;

    let blockchainAudit;

    if (userId) {
      blockchainAudit = blockchain.getAuditTrail(userId);
    } else if (type) {
      blockchainAudit = blockchain.getBlocksByType(type.toUpperCase());
    } else {
      // Get all blocks (limited)
      blockchainAudit = blockchain.chain.slice(-parseInt(limit)).reverse();
    }

    res.json({
      success: true,
      data: {
        blockchainAudit,
        blockchainStats: blockchain.getStats()
      }
    });

  } catch (error) {
    console.error('Get blockchain audit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blockchain audit'
    });
  }
};

/**
 * Admin dashboard data
 */
const getDashboard = async (req, res) => {
  try {
    // Get pending approvals count
    const pendingApprovals = await User.countDocuments({
      approved: false,
      isActive: true,
      role: { $in: ['doctor', 'hospital'] }
    });

    // Get total users by role
    const userCounts = await User.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent security alerts
    const recentAlerts = await AuditLog.getSecurityAlerts({ limit: 5 });

    // Get system activity for last 7 days
    const weeklyActivity = await AuditLog.getActivityStats({
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      groupBy: 'day'
    });

    // Get blockchain stats
    const blockchainStats = blockchain.getStats();

    // Get recent system activities
    const recentActivity = await AuditLog.getSystemAudit({ limit: 10 });

    res.json({
      success: true,
      data: {
        statistics: {
          pendingApprovals,
          userCounts,
          blockchainStats
        },
        recentAlerts,
        weeklyActivity,
        recentActivity
      }
    });

  } catch (error) {
    console.error('Get admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard data'
    });
  }
};

module.exports = {
  getPendingUsers,
  approveUser,
  rejectUser,
  getAllUsers,
  toggleUserStatus,
  getSystemAudit,
  getSecurityAlerts,
  getSystemStats,
  getBlockchainAudit,
  getDashboard
};
