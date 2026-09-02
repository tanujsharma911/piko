import { MessageSquare } from "lucide-react";

const Home = () => {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="size-16 rounded-2xl bg-muted flex items-center justify-center">
          <MessageSquare className="size-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Start a conversation
          </h1>
          <p className="text-muted-foreground text-sm max-w-sm">
            Click <span className="font-medium text-foreground">New Chat</span> in the sidebar to begin chatting.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Home;
