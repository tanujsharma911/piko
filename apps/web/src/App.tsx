import { Outlet, useNavigate } from "react-router";
import { useAuthStore } from "./store/auth.store";
import { useEffect } from "react";
import { backendApi } from "./services/api.service";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import Layout from "./components/Layout";

const queryClient = new QueryClient();

const SwiggyCallbackHandler = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const swiggyResult = params.get("swiggy");
    if (swiggyResult) {
      queryClient.invalidateQueries({ queryKey: ["swiggy-status"] });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [queryClient]);

  return null;
};

const App = () => {
  const navigate = useNavigate();
  const { loading } = useAuthStore();
  const { isLoggedIn, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    backendApi
      .getMe()
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        setUser(null);
        navigate("/login");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isLoggedIn]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Layout>
        <SwiggyCallbackHandler />
        <Outlet />
      </Layout>
    </QueryClientProvider>
  );
};

export default App;
