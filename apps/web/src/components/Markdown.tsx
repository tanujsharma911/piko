import { createContext, useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeRaw from "rehype-raw";
import { cn } from "@/lib/utils";

const InTableContext = createContext(false);

const Markdown = ({
  children,
  className,
}: {
  children: string;
  className?: string;
}) => (
  <div
    className={cn(
      "prose prose-sm dark:prose-invert max-w-none overflow-x-auto",
      className,
    )}
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, rehypeSanitize]}
      components={{
        table: ({ children }) => (
          <InTableContext.Provider value={true}>
            <table>{children}</table>
          </InTableContext.Provider>
        ),
        img: ({ node, ...props }) => {
          const inTable = useContext(InTableContext);
          const img = (
            <img
              {...props}
              loading="lazy"
              className="my-1 inline-block max-w-full h-auto rounded-md border border-border"
            />
          );
          if (!inTable) return img;
          return (
            <a
              href={props.src}
              target="_blank"
              rel="noreferrer"
              className="inline-block max-w-full"
            >
              {img}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
);

export default Markdown;
