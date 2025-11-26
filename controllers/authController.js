const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const blockchain = require('../blockchain');
const nodemailer = require('nodemailer');

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '24h'
  });
};

/**
 * Register a new user
 */
const register = async (req, res) => {
  try {
    const { name, email, password, role, profileData } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, password, and role'
      });
    }

    // Validate role
    const validRoles = ['patient', 'doctor', 'hospital', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be one of: patient, doctor, hospital, admin'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      await AuditLog.logActivity(
        null,
        'REGISTER',
        `Registration attempt with existing email: ${email}`,
        {
          resourceType: 'user',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            email,
            role
          },
          severity: 'low',
          status: 'failure'
        }
      );

      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role,
      profileData: profileData || {}
    });

    await user.save();

    // Record registration on blockchain
    const blockchainRecord = blockchain.recordVerification(
      user._id.toString(),
      'system',
      'REGISTERED'
    );

    // Log the registration
    await AuditLog.logActivity(
      user._id,
      'REGISTER',
      `New ${role} registered: ${name}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          email,
          role
        },
        blockchainHash: blockchainRecord.hash,
        severity: 'low',
        status: 'success'
      }
    );

    // Generate token
    const token = generateToken(user._id);

    // Return user data without password
    const userData = user.getPublicProfile();

    res.status(201).json({
      success: true,
      message: role === 'patient' || role === 'admin' 
        ? 'Registration successful' 
        : 'Registration successful. Awaiting admin approval.',
      data: {
        user: userData,
        token,
        needsApproval: ['doctor', 'hospital'].includes(role) && !user.approved
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    await AuditLog.logActivity(
      null,
      'REGISTER',
      `Registration failed: ${error.message}`,
      {
        resourceType: 'system',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          errorMessage: error.message,
          requestData: req.body
        },
        severity: 'medium',
        status: 'failure'
      }
    );

    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
};

/**
 * Login user
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user and include password for comparison
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user) {
      await AuditLog.logActivity(
        null,
        'FAILED_LOGIN',
        `Login attempt with non-existent email: ${email}`,
        {
          resourceType: 'system',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            email
          },
          severity: 'medium',
          status: 'failure'
        }
      );

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await AuditLog.logActivity(
        user._id,
        'FAILED_LOGIN',
        `Invalid password attempt for user: ${email}`,
        {
          resourceType: 'user',
          targetId: user._id,
          targetModel: 'User',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            email
          },
          severity: 'medium',
          status: 'failure'
        }
      );

      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      await AuditLog.logActivity(
        user._id,
        'FAILED_LOGIN',
        `Login attempt by deactivated user: ${email}`,
        {
          resourceType: 'user',
          targetId: user._id,
          targetModel: 'User',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            email
          },
          severity: 'medium',
          status: 'failure'
        }
      );

      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Log successful login
    await AuditLog.logActivity(
      user._id,
      'LOGIN',
      `Successful login: ${user.name}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          email
        },
        severity: 'low',
        status: 'success'
      }
    );

    // Return user data without password
    const userData = user.getPublicProfile();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userData,
        token,
        needsApproval: ['doctor', 'hospital'].includes(user.role) && !user.approved
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    
    await AuditLog.logActivity(
      null,
      'FAILED_LOGIN',
      `Login system error: ${error.message}`,
      {
        resourceType: 'system',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          errorMessage: error.message,
          requestData: req.body
        },
        severity: 'high',
        status: 'failure'
      }
    );

    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.'
    });
  }
};

/**
 * Logout user (client-side token removal, server-side logging)
 */
const logout = async (req, res) => {
  try {
    // Log the logout
    await AuditLog.logActivity(
      req.user._id,
      'LOGOUT',
      `User logged out: ${req.user.name}`,
      {
        resourceType: 'user',
        targetId: req.user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        },
        severity: 'low',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
};

/**
 * Get current user profile
 */
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userData = user.getPublicProfile();

    res.json({
      success: true,
      data: {
        user: userData,
        needsApproval: ['doctor', 'hospital'].includes(user.role) && !user.approved
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
 * Update user profile
 */
const updateProfile = async (req, res) => {
  try {
    const { name, profileData } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Store old values for audit
    const oldValues = {
      name: user.name,
      profileData: user.profileData
    };

    // Update allowed fields
    if (name) user.name = name.trim();
    if (profileData) {
      user.profileData = { ...user.profileData, ...profileData };
    }

    await user.save();

    // Log the update
    await AuditLog.logActivity(
      user._id,
      'RECORD_UPDATE',
      `Profile updated: ${user.name}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          oldValues,
          newValues: {
            name: user.name,
            profileData: user.profileData
          }
        },
        severity: 'low',
        status: 'success'
      }
    );

    const userData = user.getPublicProfile();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: userData }
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
 * Change password
 */
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      await AuditLog.logActivity(
        user._id,
        'PASSWORD_CHANGE',
        `Failed password change attempt - invalid current password`,
        {
          resourceType: 'user',
          targetId: user._id,
          targetModel: 'User',
          metadata: {
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          },
          severity: 'medium',
          status: 'failure'
        }
      );

      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Log successful password change
    await AuditLog.logActivity(
      user._id,
      'PASSWORD_CHANGE',
      `Password changed successfully`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        },
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password'
    });
  }
};

/**
 * Forgot password - send OTP
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to user
    user.otp = otp;
    user.otpExpires = otpExpires;
    await user.save();

    // Check if email credentials are configured
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('Email credentials not configured');
      return res.status(500).json({
        success: false,
        message: 'Email service not configured. Please contact administrator.'
      });
    }

    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail', // or your email service
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Email options
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Password Reset Request</h2>
          <p>Hello ${user.name},</p>
          <p>You requested a password reset for your EHR account.</p>
          <p>Your OTP is: <strong>${otp}</strong></p>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <br>
          <p>Best regards,<br>EHR System Team</p>
        </div>
      `
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Log the action
    await AuditLog.logActivity(
      user._id,
      'PASSWORD_RESET_REQUEST',
      `Password reset OTP sent to ${email}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          email
        },
        severity: 'low',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'If the email exists, an OTP has been sent'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.'
    });
  }
};

/**
 * Verify OTP
 */
const verifyOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and OTP'
      });
    }

    // Find user with OTP fields
    const user = await User.findOne({ email: email.toLowerCase() }).select('+otp +otpExpires');
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or OTP'
      });
    }

    // Check if OTP exists and not expired
    if (!user.otp || !user.otpExpires || user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // OTP is valid, return success (don't clear OTP yet, will be cleared on reset)
    res.json({
      success: true,
      message: 'OTP verified successfully'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
};

/**
 * Reset password with OTP
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email, OTP, and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Find user with OTP fields
    const user = await User.findOne({ email: email.toLowerCase() }).select('+otp +otpExpires');
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or OTP'
      });
    }

    // Check if OTP exists and not expired
    if (!user.otp || !user.otpExpires || user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Update password and clear OTP
    user.password = newPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    // Log the password reset
    await AuditLog.logActivity(
      user._id,
      'PASSWORD_RESET',
      `Password reset successful for user: ${email}`,
      {
        resourceType: 'user',
        targetId: user._id,
        targetModel: 'User',
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          email
        },
        severity: 'medium',
        status: 'success'
      }
    );

    res.json({
      success: true,
      message: 'Password reset successful'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  updateProfile,
  changePassword,
  forgotPassword,
  verifyOTP,
  resetPassword
};
