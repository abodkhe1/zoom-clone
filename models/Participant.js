const mongoose = require('mongoose');

const ParticipantSchema = new mongoose.Schema({
  meetingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meeting',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
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
    handRaised: { type: Boolean, default: false }
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  leftAt: Date
});

module.exports = mongoose.model('Participant', ParticipantSchema);