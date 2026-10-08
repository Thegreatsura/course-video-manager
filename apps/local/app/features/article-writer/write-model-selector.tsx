import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/use-local-storage";
import {
  ARTICLE_WRITER_MODEL,
  ARTICLE_WRITER_MODEL_STORAGE_KEY,
  ARTICLE_WRITER_MODELS,
  type ArticleWriterModel,
  resolveArticleWriterModel,
} from "@/services/article-writer-model";

/**
 * The writer's chosen model, remembered across sessions. A saved value that
 * names a model no longer offered reads as the default.
 */
export function useArticleWriterModel(): [
  ArticleWriterModel,
  (model: ArticleWriterModel) => void,
] {
  const [raw, setRaw] = useLocalStorage(
    ARTICLE_WRITER_MODEL_STORAGE_KEY,
    ARTICLE_WRITER_MODEL
  );
  return [resolveArticleWriterModel(raw), setRaw];
}

export function WriteModelSelector(props: {
  model: ArticleWriterModel;
  onModelChange: (model: ArticleWriterModel) => void;
  disabled?: boolean;
}) {
  const { model, onModelChange, disabled } = props;
  return (
    <Select
      value={model}
      onValueChange={(value) => onModelChange(resolveArticleWriterModel(value))}
      disabled={disabled}
    >
      <SelectTrigger className="w-[130px]" aria-label="Model">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ARTICLE_WRITER_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
