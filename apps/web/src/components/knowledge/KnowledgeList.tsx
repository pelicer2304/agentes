import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, ToggleLeft, ToggleRight } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import type { KnowledgeGrouped, KnowledgeItem } from '@/types';

interface KnowledgeListProps {
  items: KnowledgeGrouped;
  onEdit: (item: KnowledgeItem) => void;
  onToggleActive: (item: KnowledgeItem) => void;
}

export function KnowledgeList({ items, onEdit, onToggleActive }: KnowledgeListProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(items))
  );

  const categories = Object.keys(items).sort();

  function toggleCategory(category: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted">Nenhum item na base de conhecimento.</p>
    );
  }

  return (
    <div className="space-y-2">
      {categories.map((category) => {
        const isExpanded = expandedCategories.has(category);
        const categoryItems = items[category];

        return (
          <div key={category} className="rounded-card border border-border bg-card">
            <button
              type="button"
              onClick={() => toggleCategory(category)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-card/80"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted" />
              )}
              <span className="capitalize">{category}</span>
              <Badge variant="default" className="ml-auto">
                {categoryItems.length}
              </Badge>
            </button>

            {isExpanded && (
              <div className="border-t border-border">
                {categoryItems.map((item) => (
                  <KnowledgeListItem
                    key={item.id}
                    item={item}
                    onEdit={onEdit}
                    onToggleActive={onToggleActive}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface KnowledgeListItemProps {
  item: KnowledgeItem;
  onEdit: (item: KnowledgeItem) => void;
  onToggleActive: (item: KnowledgeItem) => void;
}

function KnowledgeListItem({ item, onEdit, onToggleActive }: KnowledgeListItemProps) {
  const contentPreview =
    item.content.length > 80
      ? item.content.slice(0, 80) + '...'
      : item.content;

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{item.title}</span>
          <Badge variant={item.active ? 'success' : 'default'}>
            {item.active ? 'Ativo' : 'Inativo'}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{contentPreview}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onToggleActive(item)}
          title={item.active ? 'Desativar' : 'Ativar'}
        >
          {item.active ? (
            <ToggleRight className="h-4 w-4 text-accent" />
          ) : (
            <ToggleLeft className="h-4 w-4 text-muted" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(item)}
          title="Editar"
        >
          <Pencil className="h-4 w-4 text-muted" />
        </Button>
      </div>
    </div>
  );
}
