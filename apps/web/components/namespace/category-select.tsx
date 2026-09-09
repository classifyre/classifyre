"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { type NamespaceCategory } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@workspace/ui/components/multi-select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { CreateCategoryDialog } from "@/components/namespace/create-category-dialog";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Category picker for the workspace create/edit forms: pick any number of
 * existing categories, or make a new one without leaving the form (the new
 * category is selected the moment it exists).
 *
 * Leaving the selection empty is allowed here and resolved by the API to the
 * default category — a workspace is never uncategorised, but the operator
 * should not have to know that to save a form.
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  onCategoryCreated,
  loading = false,
  disabled = false,
}: {
  categories: NamespaceCategory[];
  value: string[];
  onChange: (categoryIds: string[]) => void;
  /** Lets the parent add the fresh category to its own list. */
  onCategoryCreated: (category: NamespaceCategory) => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = React.useState(false);

  if (loading) return <Skeleton className="h-9 w-full bg-muted" />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect values={value} onValuesChange={onChange}>
          <MultiSelectTrigger
            className="min-w-0 flex-1 basis-56"
            disabled={disabled}
            aria-label={t("categories.selectAria")}
          >
            <MultiSelectValue
              placeholder={t("categories.placeholder")}
              overflowBehavior="wrap-when-open"
            />
          </MultiSelectTrigger>
          <MultiSelectContent
            search={{
              placeholder: t("categories.searchPlaceholder"),
              emptyMessage: t("categories.noneFound"),
            }}
          >
            {categories.map((category) => (
              <MultiSelectItem key={category.id} value={category.id}>
                {category.title}
              </MultiSelectItem>
            ))}
          </MultiSelectContent>
        </MultiSelect>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={disabled}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          {t("categories.newShort")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("categories.selectHint")}
      </p>

      <CreateCategoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(category) => {
          onCategoryCreated(category);
          // Auto-select: creating a category from inside this form only ever
          // means "and put this workspace in it".
          onChange([...value.filter((id) => id !== category.id), category.id]);
        }}
      />
    </>
  );
}
