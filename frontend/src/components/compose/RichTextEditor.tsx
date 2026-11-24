import { useEditor, EditorContent } from '@tiptap/react';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  List,
  ListOrdered,
  Quote,
  Code2,
  Type,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string, text: string) => void;
  placeholder?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Type Your Reply...',
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML(), ed.getText());
    },
  });

  if (!editor) return null;

  const toolBtn = (active: boolean) =>
    `p-1.5 rounded-md transition-colors cursor-pointer ${
      active
        ? 'bg-[#E8F5EC] text-[#08A842]'
        : 'text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]'
    }`;

  return (
    <div className="rounded-2xl bg-[#FAFAFA] border border-[#F0F2F4] p-5 min-h-[340px] flex flex-col">
      {/* Floating White Pill Toolbar matching Figma Compose Frames */}
      <div className="inline-flex flex-wrap items-center gap-1 self-start bg-white rounded-full border border-[#F0F2F4] shadow-xs px-3 py-1.5 mb-4">
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-1.5 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] disabled:opacity-35 cursor-pointer"
          title="Undo"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-1.5 rounded-md text-[#6B7280] hover:bg-[#F3F4F6] disabled:opacity-35 cursor-pointer"
          title="Redo"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-[#E5E7EB] mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={toolBtn(editor.isActive('heading', { level: 3 }))}
          title="Heading Size"
        >
          <Type className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-[#E5E7EB] mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={toolBtn(editor.isActive('bold'))}
          title="Bold"
        >
          <Bold className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={toolBtn(editor.isActive('italic'))}
          title="Italic"
        >
          <Italic className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={toolBtn(editor.isActive('underline'))}
          title="Underline"
        >
          <UnderlineIcon className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-[#E5E7EB] mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={toolBtn(editor.isActive({ textAlign: 'left' }))}
          title="Align Left"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={toolBtn(editor.isActive({ textAlign: 'center' }))}
          title="Align Center"
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-[#E5E7EB] mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={toolBtn(editor.isActive('orderedList'))}
          title="Numbered List"
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={toolBtn(editor.isActive('bulletList'))}
          title="Bulleted List"
        >
          <List className="w-3.5 h-3.5" />
        </button>

        <span className="w-px h-4 bg-[#E5E7EB] mx-1" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={toolBtn(editor.isActive('blockquote'))}
          title="Blockquote / Highlight"
        >
          <Quote className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={toolBtn(editor.isActive('codeBlock'))}
          title="Code Block"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={toolBtn(editor.isActive('strike'))}
          title="Strikethrough"
        >
          <Strikethrough className="w-3.5 h-3.5" />
        </button>
      </div>

      <EditorContent
        editor={editor}
        className="flex-1 text-[14px] text-[#111827] leading-relaxed"
      />
    </div>
  );
}
