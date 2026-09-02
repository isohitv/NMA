import mongoose, { Schema } from 'mongoose';

export interface WatchTarget {
  value: string;
  label?: string;
  port?: number;
  latencyThreshold?: number;
  enabled?: boolean;
}

const watchTargetSchema = new Schema<WatchTarget>({
  value: { type: String, required: true },
  label: String,
  port: Number,
  latencyThreshold: { type: Number, default: 250 },
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

export const WatchTargetModel = mongoose.model('WatchTarget', watchTargetSchema);
