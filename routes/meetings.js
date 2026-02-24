const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const Meeting = require('../models/Meeting');

// Create a new meeting with full settings
router.post('/create', auth, async (req, res) => {
  try {
    const roomId = uuidv4().substring(0, 8).toUpperCase();
    const { title, description, password, settings } = req.body;
    
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const userName = req.user.name;
    
    console.log('Creating meeting for user:', { userId, userName, userEmail });
    
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const meetingLinks = {
      host: `${clientUrl}/room/${roomId}?host=${userId}`,
      participant: `${clientUrl}/join/${roomId}`,
      invitation: `${clientUrl}/meeting/${roomId}`,
      registration: `${clientUrl}/register/${roomId}`
    };
    
    const meeting = new Meeting({
      roomId,
      hostId: userId,
      hostName: userName,
      hostEmail: userEmail,
      title: title || `${userName}'s Meeting`,
      description,
      password: password || null,
      links: meetingLinks,
      settings: {
        muteOnEntry: settings?.muteOnEntry || false,
        videoOffOnEntry: settings?.videoOffOnEntry || false,
        allowChat: settings?.allowChat ?? true,
        allowScreenShare: settings?.allowScreenShare ?? true,
        allowRename: settings?.allowRename || false,
        allowUnmute: settings?.allowUnmute ?? true,
        waitingRoom: settings?.waitingRoom || false,
        recordMeeting: settings?.recordMeeting || false,
        maxParticipants: settings?.maxParticipants || 100,
        allowParticipantRename: settings?.allowParticipantRename || false,
        muteUponEntry: settings?.muteUponEntry || false,
        approveEntry: settings?.approveEntry || false
      }
    });
    
    await meeting.save();
    
    res.status(201).json({
      roomId,
      meetingLinks,
      message: 'Meeting created successfully'
    });
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message 
    });
  }
});

// Get meeting details
router.get('/:roomId', auth, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId })
      .populate('hostId', 'name email')
      .populate('participants.userId', 'name email');
    
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }
    
    const isBanned = meeting.bannedParticipants.some(
      b => b.userId.toString() === req.user.userId
    );
    
    if (isBanned) {
      return res.status(403).json({ message: 'You have been banned from this meeting' });
    }
    
    res.json(meeting);
  } catch (error) {
    console.error('Get meeting error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ✅ VALIDATE ROUTE (SINGLE)
router.post('/validate', async (req, res) => {
  try {
    const { roomId, password } = req.body;
    console.log('🔍 Validating meeting:', { roomId, passwordProvided: !!password });
    
    const meeting = await Meeting.findOne({ 
      roomId: roomId,
      isActive: true 
    });
    
    console.log('📊 Meeting found:', meeting ? 'Yes' : 'No');
    
    if (!meeting) {
      return res.status(404).json({ 
        valid: false, 
        message: 'Meeting not found' 
      });
    }
    
    if (meeting.password) {
      console.log('🔐 Meeting has password, comparing...');
      if (password !== meeting.password) {
        return res.status(401).json({ 
          valid: false, 
          message: 'Invalid password' 
        });
      }
      console.log('✅ Password correct');
    }
    
    if (meeting.participants.length >= meeting.settings.maxParticipants) {
      return res.status(403).json({ 
        valid: false, 
        message: 'Meeting is full' 
      });
    }
    
    console.log('✅ Meeting validated successfully');
    
    res.json({
      valid: true,
      requiresWaitingRoom: meeting.settings.waitingRoom || false,
      meeting: {
        roomId: meeting.roomId,
        title: meeting.title,
        hostName: meeting.hostName,
        hostId: meeting.hostId,
        settings: meeting.settings
      }
    });
    
  } catch (error) {
    console.error('❌ Validation error:', error);
    res.status(500).json({ 
      valid: false, 
      message: 'Server error' 
    });
  }
});

// ✅ REGISTER ROUTE (NO AUTH MIDDLEWARE FOR GUESTS)
// ✅ REGISTER ROUTE - NO AUTH MIDDLEWARE (for guests)
// Register participant (NO AUTH REQUIRED)
router.post('/:roomId/register', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { name, email, mobile } = req.body;
    
    console.log('📝 Registering participant:', { roomId, name, email });
    
    const meeting = await Meeting.findOne({ roomId, isActive: true });
    
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }
    
    // Check if meeting is full
    if (meeting.participants.length >= meeting.settings.maxParticipants) {
      return res.status(403).json({ message: 'Meeting is full' });
    }
    
    // Add to participants
    meeting.participants.push({
      name,
      email,
      mobile: mobile || '',
      role: 'participant',
      joinedAt: new Date()
    });
    
    await meeting.save();
    
    res.json({ 
      requiresWaitingRoom: false,
      message: 'Joined successfully'
    });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get host's meetings
router.get('/host/meetings', auth, async (req, res) => {
  try {
    const meetings = await Meeting.find({ hostId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(meetings);
  } catch (error) {
    console.error('Get host meetings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check if user is a participant
router.get('/:roomId/participant/:userId', auth, async (req, res) => {
  try {
    const { roomId, userId } = req.params;
    
    const meeting = await Meeting.findOne({ roomId });
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }
    
    const isParticipant = meeting.participants.some(
      p => p.userId?.toString() === userId
    );
    
    res.json({ isParticipant });
  } catch (error) {
    console.error('Check participant error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get waiting room status
router.get('/:roomId/waiting', auth, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });
    
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }
    
    const isInWaitingRoom = meeting.waitingList.some(
      w => w.userId?.toString() === req.user.userId
    );
    
    res.json({ isInWaitingRoom });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;