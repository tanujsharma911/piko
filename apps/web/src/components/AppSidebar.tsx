import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useAuthStore } from "@/store/auth.store";
import { SquarePen, User2, ChevronsUpDown } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { backendApi } from "@/services/api.service";
import { useNavigate, useParams } from "react-router";
import { useState } from "react";
import SettingsDialog from "./SettingsDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";

const AppSidebar = () => {
  const navigate = useNavigate();
  const { conversationId: activeConversationId } = useParams();

  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => {
      return backendApi.getConversations();
    },
  });

  const createConversation = useMutation({
    mutationFn: () => {
      return backendApi.createConversation({ title: "New Conversation" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/c/${data.conversation._id}`);
    },
  });

  return (
    <>
      <Sidebar>
        <SidebarHeader>
          <div className="flex items-center justify-between">
            <span
              style={{ fontFamily: "'Ubuntu', sans-serif" }}
              className="text-xl font-bold tracking-tight"
            >
              Piko
            </span>
            <SidebarTrigger />
          </div>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => createConversation.mutate()}>
              <SquarePen />
              New Chat
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Recents</SidebarGroupLabel>
            {conversations?.conversations?.map((conversation) => {
              return (
                <SidebarMenu key={conversation._id}>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={conversation._id === activeConversationId}
                      onClick={() => navigate(`/c/${conversation._id}`)}
                      className={cn(
                        conversation._id === activeConversationId &&
                          "bg-accent-foreground",
                      )}
                    >
                      <p className="truncate text-nowrap">
                        {conversation.title || "Untitled Conversation"}
                      </p>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              );
            })}
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger render={<SidebarMenuButton />}>
                  <User2 /> {user?.name}
                  <ChevronsUpDown className="ml-auto" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/help")}>
                    Help
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive">
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
};

export default AppSidebar;
