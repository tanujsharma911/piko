import AppSidebar from "./AppSidebar";
import { SidebarProvider, SidebarTrigger, useSidebar } from "./ui/sidebar";

const ColapseButton = () => {
  const { open } = useSidebar();

  return (
    <>
      {!open && (
        <SidebarTrigger
          variant={"secondary"}
          className={"fixed top-2 left-2 z-10"}
        />
      )}
    </>
  );
};

const Layout = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <SidebarProvider>
      <AppSidebar />
      <ColapseButton />
      <main className={`w-full ${className || ""}`}>{children}</main>
    </SidebarProvider>
  );
};

export default Layout;
