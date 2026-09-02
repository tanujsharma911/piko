import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  swiggyAccessToken?: string;
  swiggyTokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  generateToken: () => string;
  comparePassword: (
    correctPassword: string,
    candidatePassword: string,
  ) => Promise<boolean>;
}

const UserSchema: Schema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true, select: false },
    swiggyAccessToken: { type: String, select: false },
    swiggyTokenExpiresAt: { type: Date, select: false },
  },
  { timestamps: true },
);

UserSchema.pre<IUser>("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.generateToken = function (): string {
  const token = jwt.sign(
    { id: this._id, email: this.email, name: this.name },
    process.env.JWT_SECRET || "default_secret",
    { expiresIn: "7d" },
  );
  return token;
};

UserSchema.methods.comparePassword = async function (
  correctPassword: string,
  candidatePassword: string,
): Promise<boolean> {
  const isMatch = await bcrypt.compare(candidatePassword, correctPassword);
  return isMatch;
};

export const User = mongoose.model<IUser>("User", UserSchema);
