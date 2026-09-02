import mongoose, { Schema, Document } from "mongoose";

export interface IConfig extends Document {
  key: string;
  value: string;
}

const ConfigSchema: Schema = new Schema<IConfig>({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
});

export const Config = mongoose.model<IConfig>("Config", ConfigSchema);
