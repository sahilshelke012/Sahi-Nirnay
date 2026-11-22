import mongoose from 'mongoose';

export const PROGRAMMES = ['The Decision Lab', 'The Transformation'];

export function contactModel(connection) {
  return connection.model('Contact', new mongoose.Schema({
    fullName: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, maxlength: 254 },
    phone: { type: String, required: true, maxlength: 30 },
    subject: { type: String, maxlength: 120 },
    programmeInterest: { type: String, enum: PROGRAMMES },
    message: { type: String, required: true, maxlength: 2000 },
  }, {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    bufferCommands: false,
  }));
}
