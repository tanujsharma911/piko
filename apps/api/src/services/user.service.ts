import { User, type IUser } from "db";

export const userService = {
  getUserById: async (id: string): Promise<IUser | null> => {
    try {
      const user = await User.findById(id);
      return user;
    } catch (error) {
      throw new Error("Error fetching user by ID");
    }
  },

  getUserByEmail: async (
    email: string,
    options?: { withPassword: boolean },
  ): Promise<IUser | null> => {
    try {
      if (options?.withPassword) {
        const user = await User.findOne({ email }).select("+password");
        return user;
      }

      const user = await User.findOne({ email });
      return user;
    } catch (error) {
      throw new Error("Error fetching user by email");
    }
  },

  createUser: async (data: {
    name: string;
    email: string;
    password: string;
  }): Promise<IUser> => {
    try {
      const user = await User.create(data);
      return user;
    } catch (error) {
      throw new Error("Error creating user");
    }
  },
};
