import { create } from "zustand";

export interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  isLoggedIn: boolean;
  loading: boolean;

  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoggedIn: false,
  loading: true,

  setUser: (user) =>
    set({
      user,
      isLoggedIn: user !== null,
    }),

  setLoading: (loading) => set({ loading }),

  logout: () =>
    set({
      user: null,
      isLoggedIn: false,
    }),
}));
