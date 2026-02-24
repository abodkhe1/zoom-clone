const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      console.log('Auth middleware: No token provided');
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    console.log('Auth middleware: Verifying token...');
    
    // Verify token with the same secret used to sign
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Auth middleware: Token verified for user:', decoded.email);
    
    // Get full user details from database
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      console.log('Auth middleware: User not found:', decoded.userId);
      return res.status(401).json({ message: 'User not found' });
    }
    
    req.user = {
      userId: user._id,
      email: user.email,
      name: user.name
    };
    
    console.log('Auth middleware: User authenticated:', {
      userId: user._id,
      email: user.email,
      name: user.name
    });
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error.name, error.message);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    
    res.status(401).json({ message: 'Authentication failed' });
  }
};