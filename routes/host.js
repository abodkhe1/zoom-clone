const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Meeting = require('../models/Meeting');

// Middleware to check if user is host
const isHost = async (req, res, next) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId });
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }
    
    if (meeting.hostId.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Host access required' });
    }
    
    req.meeting = meeting;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Get all participants
router.get('/:roomId/participants', auth, async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ roomId: req.params.roomId })
      .populate('participants.userId', 'name email');
    
    if (!meeting) {
      return res.status(404).json({ message: 'Meeting not found' });
    }
    
    res.json(meeting.participants);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Mute participant
router.post('/:roomId/mute-participant', auth, isHost, async (req, res) => {
  try {
    const { participantId } = req.body;
    
    const participant = req.meeting.participants.find(
      p => p.userId.toString() === participantId
    );
    
    if (participant) {
      participant.status.audio = false;
      participant.status.isMutedByHost = true;
      await req.meeting.save();
      
      // Emit socket event for mute
      req.io.to(req.params.roomId).emit('participant-muted', {
        userId: participantId,
        mutedBy: req.user.userId
      });
    }
    
    res.json({ message: 'Participant muted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Unmute participant
router.post('/:roomId/unmute-participant', auth, isHost, async (req, res) => {
  try {
    const { participantId } = req.body;
    
    const participant = req.meeting.participants.find(
      p => p.userId.toString() === participantId
    );
    
    if (participant && req.meeting.settings.allowUnmute) {
      participant.status.audio = true;
      participant.status.isMutedByHost = false;
      await req.meeting.save();
      
      req.io.to(req.params.roomId).emit('participant-unmuted', {
        userId: participantId,
        unmutedBy: req.user.userId
      });
    }
    
    res.json({ message: 'Participant unmuted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove participant
router.post('/:roomId/remove-participant', auth, isHost, async (req, res) => {
  try {
    const { participantId } = req.body;
    
    req.meeting.participants = req.meeting.participants.filter(
      p => p.userId.toString() !== participantId
    );
    
    await req.meeting.save();
    
    req.io.to(req.params.roomId).emit('participant-removed', {
      userId: participantId,
      removedBy: req.user.userId
    });
    
    // Disconnect the participant's socket
    const participant = req.meeting.participants.find(
      p => p.userId.toString() === participantId
    );
    if (participant && participant.socketId) {
      req.io.sockets.sockets.get(participant.socketId)?.disconnect();
    }
    
    res.json({ message: 'Participant removed' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Ban participant
router.post('/:roomId/ban-participant', auth, isHost, async (req, res) => {
  try {
    const { participantId } = req.body;
    
    req.meeting.bannedParticipants.push({
      userId: participantId,
      bannedAt: new Date()
    });
    
    req.meeting.participants = req.meeting.participants.filter(
      p => p.userId.toString() !== participantId
    );
    
    await req.meeting.save();
    
    req.io.to(req.params.roomId).emit('participant-banned', {
      userId: participantId,
      bannedBy: req.user.userId
    });
    
    res.json({ message: 'Participant banned' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Update meeting settings
router.put('/:roomId/settings', auth, isHost, async (req, res) => {
  try {
    const settings = req.body;
    
    req.meeting.settings = { ...req.meeting.settings, ...settings };
    await req.meeting.save();
    
    req.io.to(req.params.roomId).emit('meeting-settings-updated', req.meeting.settings);
    
    res.json(req.meeting.settings);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Admit from waiting room
router.post('/:roomId/admit-participant', auth, isHost, async (req, res) => {
  try {
    const { participantId } = req.body;
    
    const waitingParticipant = req.meeting.waitingRoom.find(
      w => w.userId.toString() === participantId
    );
    
    if (waitingParticipant) {
      req.meeting.participants.push({
        userId: waitingParticipant.userId,
        name: waitingParticipant.name,
        email: waitingParticipant.email,
        role: 'participant'
      });
      
      req.meeting.waitingRoom = req.meeting.waitingRoom.filter(
        w => w.userId.toString() !== participantId
      );
      
      await req.meeting.save();
      
      req.io.to(req.params.roomId).emit('participant-admitted', {
        userId: participantId,
        name: waitingParticipant.name
      });
    }
    
    res.json({ message: 'Participant admitted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// End meeting for all
router.post('/:roomId/end-meeting', auth, isHost, async (req, res) => {
  try {
    req.meeting.isActive = false;
    req.meeting.endedAt = new Date();
    await req.meeting.save();
    
    // Disconnect all participants
    req.io.to(req.params.roomId).emit('meeting-ended', {
      endedBy: req.user.userId
    });
    
    // Disconnect all sockets in the room
    const room = req.io.sockets.adapter.rooms.get(req.params.roomId);
    if (room) {
      room.forEach(socketId => {
        req.io.sockets.sockets.get(socketId)?.disconnect();
      });
    }
    
    res.json({ message: 'Meeting ended' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Make co-host
router.post('/:roomId/make-cohost', auth, isHost, async (req, res) => {
  try {
    const { participantId } = req.body;
    
    const participant = req.meeting.participants.find(
      p => p.userId.toString() === participantId
    );
    
    if (participant) {
      participant.role = 'co-host';
      await req.meeting.save();
      
      req.io.to(req.params.roomId).emit('participant-promoted', {
        userId: participantId,
        newRole: 'co-host'
      });
    }
    
    res.json({ message: 'Participant made co-host' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;