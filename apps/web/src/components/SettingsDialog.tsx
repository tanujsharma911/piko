import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "./ui/button";
import { Plug, Unplug, CheckCircle2 } from "lucide-react";
import { backendApi } from "@/services/api.service";

const SettingsDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["swiggy-status"],
    queryFn: () => backendApi.getSwiggyStatus(),
    enabled: open,
  });

  const connectMutation = useMutation({
    mutationFn: () => backendApi.getSwiggyConnectUrl(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => backendApi.disconnectSwiggy(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swiggy-status"] });
    },
    onError: (error) => {
      console.error("Disconnect failed:", error);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your integrations.</DialogDescription>
        </DialogHeader>

        {status?.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="text-green-500" />
              <span className="text-sm">Swiggy connected</span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              <Unplug />
              Disconnect
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
          >
            <Plug />
            Connect Swiggy
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SettingsDialog;
