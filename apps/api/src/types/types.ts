import type { IUser } from "db";
import type { Request } from "express";

export interface AuthRequest extends Request {
  user?: IUser;
}
