const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

/**
 * Middleware to authenticate JWT tokens
 */
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      await AuditLog.logActivity(
        null,
        'UNAUTHORIZED_ACCESS',
        'Access attempt without token',
        {
          resourceType: 'system',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.originalUrl
          },
          severity: 'medium',
          status: 'failure'
        }
      );
      
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      await AuditLog.logActivity(
        decoded.userId,
        'UNAUTHORIZED_ACCESS',
        'Access attempt with invalid user token',
        {
          resourceType: 'system',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.originalUrl
          },
          severity: 'high',
          status: 'failure'
        }
      );
      
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token. User not found.' 
      });
    }

    if (!user.isActive) {
      await AuditLog.logActivity(
        user._id,
        'UNAUTHORIZED_ACCESS',
        'Access attempt by deactivated user',
        {
          resourceType: 'user',
          targetId: user._id,
          targetModel: 'User',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            endpoint: req.originalUrl
          },
          severity: 'medium',
          status: 'failure'
        }
      );
      
      return res.status(401).json({ 
        success: false, 
        message: 'Account is deactivated.' 
      });
    }

    // Update last login time
    user.lastLogin = new Date();
    await user.save();

    req.user = user;
    next();
  } catch (error) {
    await AuditLog.logActivity(
      null,
      'UNAUTHORIZED_ACCESS',
      `Token verification failed: ${error.message}`,
      {
        resourceType: 'system',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          endpoint: req.originalUrl,
          errorMessage: error.message
        },
        severity: 'medium',
        status: 'failure'
      }
    );
    
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

/**
 * Middleware to authorize specific roles
 */
const authorize = (...roles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          success: false, 
          message: 'Authentication required.' 
        });
      }

      if (!roles.includes(req.user.role)) {
        await AuditLog.logActivity(
          req.user._id,
          'UNAUTHORIZED_ACCESS',
          `Insufficient permissions. Required: ${roles.join(', ')}, Has: ${req.user.role}`,
          {
            resourceType: 'system',
            targetId: req.user._id,
            targetModel: 'User',
            metadata: {
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              endpoint: req.originalUrl,
              requiredRoles: roles,
              userRole: req.user.role
            },
            severity: 'medium',
            status: 'failure'
          }
        );
        
        return res.status(403).json({ 
          success: false, 
          message: 'Insufficient permissions.' 
        });
      }

      // Check if user needs approval (for doctors and hospitals)
      if (['doctor', 'hospital'].includes(req.user.role) && !req.user.approved) {
        await AuditLog.logActivity(
          req.user._id,
          'UNAUTHORIZED_ACCESS',
          'Access attempt by unapproved user',
          {
            resourceType: 'user',
            targetId: req.user._id,
            targetModel: 'User',
            metadata: {
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              endpoint: req.originalUrl
            },
            severity: 'low',
            status: 'failure'
          }
        );
        
        return res.status(403).json({ 
          success: false, 
          message: 'Account pending approval.' 
        });
      }

      next();
    } catch (error) {
      console.error('Authorization error:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Authorization check failed.' 
      });
    }
  };
};

/**
 * Middleware to check if user is approved (for doctors and hospitals)
 */
const requireApproval = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required.' 
      });
    }

    if (['doctor', 'hospital'].includes(req.user.role) && !req.user.approved) {
      return res.status(403).json({ 
        success: false, 
        message: 'Account pending approval. Please wait for admin verification.' 
      });
    }

    next();
  } catch (error) {
    console.error('Approval check error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Approval check failed.' 
    });
  }
};

/**
 * Middleware to validate patient ownership or doctor access
 */
const validatePatientAccess = async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const user = req.user;

    // Patients can access their own data
    if (user.role === 'patient' && user._id.toString() === patientId) {
      return next();
    }

    // Doctors need consent to access patient data
    if (user.role === 'doctor') {
      const Consent = require('../models/Consent');
      const hasAccess = await Consent.hasAccess(user._id, patientId, 'view');
      
      if (!hasAccess) {
        await AuditLog.logActivity(
          user._id,
          'UNAUTHORIZED_ACCESS',
          `Doctor attempted to access patient data without consent`,
          {
            resourceType: 'user',
            targetId: patientId,
            targetModel: 'User',
            metadata: {
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              endpoint: req.originalUrl,
              doctorId: user._id,
              patientId
            },
            severity: 'high',
            status: 'failure'
          }
        );
        
        return res.status(403).json({ 
          success: false, 
          message: 'No consent granted for accessing this patient data.' 
        });
      }
    }

    // Hospitals and admins have broader access
    if (['hospital', 'admin'].includes(user.role)) {
      return next();
    }

    // Default deny
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied.' 
    });

  } catch (error) {
    console.error('Patient access validation error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Access validation failed.' 
    });
  }
};

/**
 * Middleware to log API access
 */
const logAccess = (action) => {
  return async (req, res, next) => {
    try {
      if (req.user) {
        await AuditLog.logActivity(
          req.user._id,
          action,
          `${action} - ${req.method} ${req.originalUrl}`,
          {
            resourceType: 'system',
            metadata: {
              ipAddress: req.ip,
              userAgent: req.get('User-Agent'),
              endpoint: req.originalUrl,
              method: req.method,
              requestData: req.method === 'GET' ? req.query : req.body
            },
            severity: 'low',
            status: 'success'
          }
        );
      }
      next();
    } catch (error) {
      console.error('Access logging error:', error);
      next(); // Continue even if logging fails
    }
  };
};

module.exports = {
  authenticate,
  authorize,
  requireApproval,
  validatePatientAccess,
  logAccess
};
