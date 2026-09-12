"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
  type Editor,
} from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Typography from "@tiptap/extension-typography";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link2,
  Highlighter,
  Undo2,
  Redo2,
  ChevronDown,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Minus,
  Plus,
  FileText,
  Lightbulb,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Copy,
  GripVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Command,
  CommandList,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { safeLink, type DocNode } from "@/lib/folio/model";
import { toast } from "sonner";

function ToggleView({ node, updateAttributes, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="toggle-block">
      <details open>
        <summary contentEditable={false}>
          <input
            readOnly={!editor.isEditable}
            aria-label="Toggle title"
            value={String(node.attrs.title)}
            onChange={(e) => updateAttributes({ title: e.target.value })}
          />
        </summary>
        <NodeViewContent className="toggle-content" />
      </details>
    </NodeViewWrapper>
  );
}
const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { title: { default: "Toggle" } };
  },
  parseHTML() {
    return [{ tag: "details", contentElement: ".toggle-content" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "details",
      mergeAttributes(HTMLAttributes),
      [
        "summary",
        { contenteditable: "false" },
        String(HTMLAttributes.title ?? "Toggle"),
      ],
      ["div", { class: "toggle-content" }, 0],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML() {
    return ["aside", { "data-callout": "true" }, 0];
  },
});
type BlockCommand = {
  name: string;
  description: string;
  icon: typeof Type;
  keywords?: string;
  run: (editor: Editor) => void;
};
function commands(onSubpage: () => void): BlockCommand[] {
  return [
    {
      name: "Text",
      description: "Just start writing with plain text.",
      icon: Type,
      run: (e) => e.chain().focus().setParagraph().run(),
    },
    {
      name: "Heading 1",
      description: "A big section heading.",
      icon: Heading1,
      keywords: "h1",
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      name: "Heading 2",
      description: "A medium section heading.",
      icon: Heading2,
      keywords: "h2",
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: "Heading 3",
      description: "A small section heading.",
      icon: Heading3,
      keywords: "h3",
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      name: "To-do list",
      description: "Keep track with a checklist.",
      icon: ListTodo,
      keywords: "todo task checkbox",
      run: (e) => e.chain().focus().toggleTaskList().run(),
    },
    {
      name: "Bulleted list",
      description: "Create a simple bulleted list.",
      icon: List,
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Numbered list",
      description: "Create a list with numbering.",
      icon: ListOrdered,
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "Quote",
      description: "Capture a quote or an excerpt.",
      icon: Quote,
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "Callout",
      description: "Make an idea stand out.",
      icon: Lightbulb,
      run: (e) => e.chain().focus().wrapIn("callout").run(),
    },
    {
      name: "Toggle",
      description: "Tuck notes into a collapsible block.",
      icon: ChevronRight,
      run: (e) => e.chain().focus().wrapIn("toggle").run(),
    },
    {
      name: "Code",
      description: "Write a code snippet.",
      icon: Code,
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      name: "Divider",
      description: "Separate sections with a line.",
      icon: Minus,
      run: (e) => e.chain().focus().setHorizontalRule().run(),
    },
    {
      name: "Page",
      description: "Add a nested page.",
      icon: FileText,
      keywords: "subpage",
      run: () => onSubpage(),
    },
  ];
}
export function RichEditor({
  content,
  onChange,
  onSubpage,
  readOnly = false,
}: {
  content: DocNode;
  readOnly?: boolean;
  onChange: (content: DocNode) => void;
  onSubpage: () => void;
}) {
  const changeRef = useRef(onChange);
  const [slash, setSlash] = useState<{
      from: number;
      to: number;
      query: string;
      x: number;
      y: number;
    } | null>(null),
    [selected, setSelected] = useState(0),
    [linkOpen, setLinkOpen] = useState(false),
    [link, setLink] = useState(""),
    [, render] = useState(0);
  const slashRef = useRef(slash),
    selectedRef = useRef(0);
  const items = commands(onSubpage),
    itemsRef = useRef(items);
  const filteredItems = items.filter((c) =>
    `${c.name} ${c.keywords ?? ""}`.toLowerCase().includes(slash?.query ?? ""),
  );
  useLayoutEffect(() => {
    changeRef.current = onChange;
    slashRef.current = slash;
    selectedRef.current = selected;
    itemsRef.current = filteredItems;
  }, [onChange, slash, selected, filteredItems]);
  const dismissRef = useRef<number | null>(null);
  function execute(editor: Editor, item: BlockCommand) {
    const s = slashRef.current;
    if (s) {
      editor.chain().focus().deleteRange({ from: s.from, to: s.to }).run();
    }
    setSlash(null);
    dismissRef.current = null;
    item.run(editor);
  }
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: readOnly,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          isAllowedUri: (url) => safeLink(url),
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      Highlight.configure({ multicolor: true }),
      Typography,
      Callout,
      Toggle,
    ],
    content,
    editorProps: {
      attributes: {
        class: "folio-editor",
        "aria-label": "Page content",
        role: "textbox",
        "aria-multiline": "true",
      },
      handleKeyDown: (view, event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          ["b", "i", "u"].includes(event.key.toLowerCase())
        )
          event.stopPropagation();
        const s = slashRef.current;
        if (!s) return false;
        if (event.key === "Escape") {
          event.preventDefault();
          dismissRef.current = s.from;
          setSlash(null);
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSelected(
            (i) =>
              (i +
                (event.key === "ArrowDown" ? 1 : -1) +
                Math.max(itemsRef.current.length, 1)) %
              Math.max(itemsRef.current.length, 1),
          );
          return true;
        }
        if (event.key === "Enter" && itemsRef.current.length) {
          event.preventDefault();
          queueMicrotask(() => {
            if (editor)
              execute(
                editor,
                itemsRef.current[selectedRef.current] ?? itemsRef.current[0],
              );
          });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => changeRef.current(e.getJSON() as DocNode),
    onTransaction: ({ editor: e }) => {
      render((n) => n + 1);
      const { $from, empty } = e.state.selection;
      const text = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
      const match = text.match(/^\/([^/]*)$/);
      if (
        empty &&
        $from.parent.type.name === "paragraph" &&
        match &&
        match[1].length < 40
      ) {
        const from = $from.start();
        if (dismissRef.current === from) return;
        const coords = e.view.coordsAtPos($from.pos);
        setSlash((old) => {
          if (old?.query !== match[1].toLowerCase()) setSelected(0);
          return {
            from,
            to: $from.pos,
            query: match[1].toLowerCase(),
            x: Math.min(coords.left, window.innerWidth - 310),
            y: Math.min(coords.bottom + 8, window.innerHeight - 350),
          };
        });
      } else {
        setSlash(null);
        dismissRef.current = null;
      }
    },
  });
  useEffect(() => {
    if (!editor) return;
    const onScroll = () => setSlash(null);
    const el = editor.view.dom.closest(".page-scroll");
    el?.addEventListener("scroll", onScroll);
    return () => el?.removeEventListener("scroll", onScroll);
  }, [editor]);
  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);
  if (!editor) return <div className="editor-loading">Opening editor…</div>;
  if (readOnly) return <div className="editor-wrap readonly-editor"><EditorContent editor={editor} /></div>;
  const formatButtons = [
    {
      label: "Bold",
      icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      icon: Underline,
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Strikethrough",
      icon: Strikethrough,
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "Inline code",
      icon: Code,
      active: editor.isActive("code"),
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: "Highlight",
      icon: Highlighter,
      active: editor.isActive("highlight"),
      run: () =>
        editor.chain().focus().toggleHighlight({ color: "#fcecc8" }).run(),
    },
  ];
  function moveBlock(direction: number) {
    if (!editor) return;
    const { $from } = editor.state.selection,
      index = $from.index(0),
      doc = editor.state.doc;
    if (index + direction < 0 || index + direction >= doc.childCount) return;
    const nodes = [];
    for (let i = 0; i < doc.childCount; i++) nodes.push(doc.child(i).toJSON());
    [nodes[index], nodes[index + direction]] = [
      nodes[index + direction],
      nodes[index],
    ];
    editor.chain().focus().setContent({ type: "doc", content: nodes }).run();
  }
  function duplicateBlock() {
    if (!editor) return;
    const { $from } = editor.state.selection,
      index = $from.index(0),
      node = editor.state.doc.child(index);
    let pos = 0;
    for (let i = 0; i <= index; i++) pos += editor.state.doc.child(i).nodeSize;
    editor.chain().focus().insertContentAt(pos, node.toJSON()).run();
  }
  return (
    <div className="editor-wrap">
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="toolbar-type" aria-label="Turn block into">
              {editor.isActive("heading")
                ? `Heading ${editor.getAttributes("heading").level}`
                : "Text"}
              <ChevronDown size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {items.slice(0, 12).map((item) => (
              <DropdownMenuItem
                key={item.name}
                onSelect={() => item.run(editor)}
              >
                <item.icon />
                {item.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="toolbar-divider" />
        {formatButtons.map((b) => (
          <button
            type="button"
            key={b.label}
            title={b.label}
            aria-label={b.label}
            aria-pressed={b.active}
            className={b.active ? "is-active" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
          >
            <b.icon size={15} />
          </button>
        ))}
        <button
          aria-label="Add link"
          title="Add link"
          className={editor.isActive("link") ? "is-active" : ""}
          onClick={() => {
            setLink(String(editor.getAttributes("link").href ?? ""));
            setLinkOpen(true);
          }}
        >
          <Link2 size={15} />
        </button>
        <span className="toolbar-divider" />
        <button
          aria-label="Undo"
          title="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={15} />
        </button>
        <button
          aria-label="Redo"
          title="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={15} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="Block actions" title="Block actions">
              <GripVertical size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={duplicateBlock}>
              <Copy />
              Duplicate block
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveBlock(-1)}>
              <ArrowUp />
              Move block up
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => moveBlock(1)}>
              <ArrowDown />
              Move block down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                editor
                  .chain()
                  .focus("end")
                  .insertContent({
                    type: "paragraph",
                    content: [{ type: "text", text: "/" }],
                  })
                  .run()
              }
            >
              <Plus />
              Insert block at end
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <EditorContent editor={editor} />
      {slash && (
        <div
          className="slash-menu"
          style={{ left: Math.max(8, slash.x), top: Math.max(55, slash.y) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Command
            shouldFilter={false}
            value={filteredItems[selected]?.name ?? ""}
            onValueChange={(value) => {
              const i = itemsRef.current.findIndex((c) => c.name === value);
              if (i >= 0) setSelected(i);
            }}
          >
            <div className="slash-label">BASIC BLOCKS</div>
            <CommandList>
              <CommandEmpty>No blocks found</CommandEmpty>
              {filteredItems.map((item) => (
                <CommandItem
                  key={item.name}
                  value={item.name}
                  onSelect={() => execute(editor, item)}
                >
                  <span className="slash-icon">
                    <item.icon size={22} />
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description}</small>
                  </span>
                </CommandItem>
              ))}
            </CommandList>
            <div className="slash-footer">
              ↑ ↓ to navigate <span>↵ to insert</span>
            </div>
          </Command>
        </div>
      )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogTitle>Add a link</DialogTitle>
          <DialogDescription>
            Link the selected text to a web page or email address.
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!link) {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkOpen(false);
                return;
              }
              if (!safeLink(link)) {
                toast.error("Use a full https://, http://, or mailto: link.");
                return;
              }
              if (editor.state.selection.empty && !editor.isActive("link"))
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: link,
                    marks: [{ type: "link", attrs: { href: link } }],
                  })
                  .run();
              else
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: link })
                  .run();
              setLinkOpen(false);
            }}
          >
            <input
              className="form-input"
              aria-label="Link URL"
              placeholder="https://example.com"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              autoFocus
            />
            <div className="dialog-actions">
              <button
                type="button"
                className="plain-button"
                onClick={() => {
                  editor.chain().focus().unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </button>
              <button className="primary-button" type="submit">
                Save link
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
