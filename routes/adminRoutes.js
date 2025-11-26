const express = require('express');
const router = express.Router();
const { authenticate, authorize, logAccess } = require('../middleware/authMiddleware');
const {
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
} = require('../controllers/adminController');

// Apply authentication and admin role authorization to all routes
router.use(authenticate);
router.use(authorize('admin'));

/**
 * @route   GET /api/admin/dashboard
 * @desc    Get admin dashboard data
 * @access  Private (Admin only)
 */
router.get('/dashboard', logAccess('DASHBOARD_VIEW'), getDashboard);

/**
 * @route   GET /api/admin/pending-users
 * @desc    Get pending user approvals
 * @access  Private (Admin only)
 */
router.get('/pending-users', logAccess('USER_VIEW'), getPendingUsers);

/**
 * @route   POST /api/admin/approve-user/:userId
 * @desc    Approve a user (doctor or hospital)
 * @access  Private (Admin only)
 */
router.post('/approve-user/:userId', logAccess('USER_APPROVE'), approveUser);

/**
 * @route   POST /api/admin/reject-user/:userId
 * @desc    Reject a user (doctor or hospital)
 * @access  Private (Admin only)
 */
router.post('/reject-user/:userId', logAccess('USER_REJECT'), rejectUser);

/**
 * @route   GET /api/admin/users
 * @desc    Get all users with filtering
 * @access  Private (Admin only)
 */
router.get('/users', logAccess('USER_VIEW'), getAllUsers);

/**
 * @route   PUT /api/admin/user/:userId/toggle-status
 * @desc    Deactivate/Activate a user
 * @access  Private (Admin only)
 */
router.put('/user/:userId/toggle-status', logAccess('USER_UPDATE'), toggleUserStatus);

/**
 * @route   GET /api/admin/audit
 * @desc    Get system audit logs
 * @access  Private (Admin only)
 */
router.get('/audit', logAccess('AUDIT_VIEW'), getSystemAudit);

/**
 * @route   GET /api/admin/security-alerts
 * @desc    Get security alerts
 * @access  Private (Admin only)
 */
router.get('/security-alerts', logAccess('AUDIT_VIEW'), getSecurityAlerts);

/**
 * @route   GET /api/admin/stats
 * @desc    Get system statistics
 * @access  Private (Admin only)
 */
router.get('/stats', logAccess('SYSTEM_VIEW'), getSystemStats);

/**
 * @route   GET /api/admin/blockchain-audit
 * @desc    Get blockchain audit trail
 * @access  Private (Admin only)
 */
router.get('/blockchain-audit', logAccess('AUDIT_VIEW'), getBlockchainAudit);

module.exports = router;
