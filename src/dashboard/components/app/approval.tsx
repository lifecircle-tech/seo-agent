import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Textarea } from "../ui/textarea";

export function MetaRewrite({
  original_content,
  updated_content,
}: {
  original_content: Record<string, any>;
  updated_content: Record<string, any>;
}) {
  const previewOriginalText = original_content;
  const previewUpdatedText = updated_content || original_content;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 border-b mb-2">
        {previewOriginalText.url && (
          <div className="space-y-2 mb-2">
            <Label>URL:</Label>
            <a
              href={previewOriginalText.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {previewOriginalText.url}
            </a>
          </div>
        )}

        {previewOriginalText.focus_keywords && (
          <div className="space-y-2 mb-2">
            <Label>Focus Keywords:</Label>
            <p>{previewOriginalText.focus_keywords.join(", ")}</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <div className="space-y-2 rounded-md border p-2 pe-0 bg-muted">
          <Label>Previous content</Label>
          <ScrollArea className="h-40 py-2 pe-3">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Title:</Label>
                <p className="rounded border p-2">
                  {previewOriginalText.current_title}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Description:</Label>
                <p className="rounded border p-2">
                  {previewOriginalText.current_description}
                </p>
              </div>
            </div>
          </ScrollArea>
        </div>
        {previewUpdatedText && (
          <div className="space-y-2 rounded-md border p-2 pe-0 bg-muted">
            <Label>Suggested content</Label>
            <ScrollArea className="h-40 py-2 pe-3">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Title:</Label>
                  <p className="rounded border p-2">
                    {previewUpdatedText.suggested_title}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Description:</Label>
                  <p className="rounded border p-2">
                    {previewUpdatedText.suggested_description}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Reason:</Label>
                  <p className="rounded border p-2">
                    {previewUpdatedText.reasoning}
                  </p>
                </div>
              </div>
            </ScrollArea>
            {/* {approval.preview_url && (
              <a
                href={approval.preview_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-xs text-blue-600 hover:underline"
              >
                Preview →
              </a>
            )} */}
          </div>
        )}
      </div>
    </>
  );
}

export function MetaRewriteForm({
  title,
  setTitle,
  description,
  setDescription,
  reasoning,
}: {
  title: string;
  setTitle: (title: string) => void;
  description: string;
  setDescription: (description: string) => void;
  reasoning: string;
}) {
  return (
    <>
      <div className="space-y-2 px-1">
        <Label>Suggested Title</Label>
        <Input
          maxLength={75}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <p className="text-xs text-end">{title.length}/75</p>
      </div>
      <div className="space-y-2 px-1">
        <Label>Suggested Description</Label>
        <Textarea
          maxLength={160}
          className="h-24"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-end">{description.length}/160</p>
      </div>
      <div className="space-y-2 px-1">
        <Label>Reasoning</Label>
        <p>{reasoning}</p>
      </div>
    </>
  );
}
