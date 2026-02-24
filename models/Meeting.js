const mongoose = require('mongoose');

const MeetingSchema = new mongoose.Schema({
  roomId: {
    type: String,
    required: true,
    unique: true
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  hostName: {
    type: String,
    required: true
  },
  hostEmail: {
    type: String,
    required: true  // This field was missing in the creation
  },
  title: {
    type: String,
    default: 'New Meeting'
  },
  description: String,
  agenda: String,
  password: {
    type: String,
    default: null
  },
  settings: {
    muteOnEntry: { type: Boolean, default: false },
    videoOffOnEntry: { type: Boolean, default: false },
    allowChat: { type: Boolean, default: true },
    allowScreenShare: { type: Boolean, default: true },
    allowRename: { type: Boolean, default: false },
    allowUnmute: { type: Boolean, default: true },
    waitingRoom: { type: Boolean, default: false },
    recordMeeting: { type: Boolean, default: false },
    maxParticipants: { type: Number, default: 100 },
    allowParticipantRename: { type: Boolean, default: false },
    muteUponEntry: { type: Boolean, default: false },
    approveEntry: { type: Boolean, default: false }
  },
  participants: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    socketId: String,
    name: String,
    email: String,
    mobile: String,
    role: { 
      type: String, 
      enum: ['host', 'co-host', 'participant'],
      default: 'participant'
    },
    status: {
      audio: { type: Boolean, default: true },
      video: { type: Boolean, default: true },
      screenShare: { type: Boolean, default: false },
      handRaised: { type: Boolean, default: false },
      isMutedByHost: { type: Boolean, default: false },
      isWaiting: { type: Boolean, default: false }
    },
    joinedAt: { type: Date, default: Date.now },
    leftAt: Date
  }],
  waitingList: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    email: String,
    mobile: String,
    requestedAt: { type: Date, default: Date.now }
  }],
  bannedParticipants: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
    bannedAt: { type: Date, default: Date.now }
  }],
  links: {
    host: String,
    participant: String,
    invitation: String,
    registration: String
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  endedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Method to check if user is host
MeetingSchema.methods.isHost = function(userId) {
  return this.hostId.toString() === userId.toString();
};

// Method to check if user is co-host
MeetingSchema.methods.isCohost = function(userId) {
  const participant = this.participants.find(p => p.userId.toString() === userId.toString());
  return participant && participant.role === 'co-host';
};

// Method to check if user is participant
MeetingSchema.methods.isParticipant = function(userId) {
  return this.participants.some(p => p.userId.toString() === userId.toString());
};

// Method to get participant by userId
MeetingSchema.methods.getParticipant = function(userId) {
  return this.participants.find(p => p.userId.toString() === userId.toString());
};

// Method to add participant to waiting list
MeetingSchema.methods.addToWaitingList = function(userData) {
  this.waitingList.push({
    userId: userData.userId,
    name: userData.name,
    email: userData.email,
    mobile: userData.mobile
  });
};

module.exports = mongoose.model('Meeting', MeetingSchema);