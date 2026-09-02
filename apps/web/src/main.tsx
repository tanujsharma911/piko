import { createRoot } from "react-dom/client";
import "./index.css";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";

import App from "./App.tsx";
import Login from "./pages/Login.tsx";
import Register from "./pages/Register.tsx";
import Home from "./pages/Home.tsx";
import ProtectedRoute from "./components/ProtectedRoute.tsx";
import Chat from "./pages/Chat.tsx";
import Help from "./pages/Help.tsx";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "login",
        element: <Login />,
      },
      {
        path: "register",
        element: <Register />,
      },
      {
        path: "c/:conversationId",
        element: (
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        ),
      },
      {
        path: "help",
        element: (
          <ProtectedRoute>
            <Help />
          </ProtectedRoute>
        ),
      },
      {
        path: "",
        element: <Home />,
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
