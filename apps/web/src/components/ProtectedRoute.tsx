import { useAuthStore } from "@/store/auth.store";
import { useEffect } from "react";
import { useNavigate } from "react-router";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const { isLoggedIn, loading } = useAuthStore();

  useEffect(() => {
    if (loading) return;

    if (!isLoggedIn) {
      navigate("/login");
    }
  }, [loading, isLoggedIn]);

  return <>{children}</>;
};

export default ProtectedRoute;
