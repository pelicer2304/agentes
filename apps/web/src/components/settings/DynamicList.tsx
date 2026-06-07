import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';

export interface DynamicListProps {
  label: string;
  items: string[];
  maxItems: number;
  maxItemLength: number;
  onChange: (items: string[]) => void;
}

export function DynamicList({
  label,
  items,
  maxItems,
  maxItemLength,
  onChange,
}: DynamicListProps) {
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    const trimmed = newItem.trim();
    if (!trimmed) return;
    if (items.length >= maxItems) return;
    if (trimmed.length > maxItemLength) return;

    onChange([...items, trimmed]);
    setNewItem('');
  };

  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <span className="text-xs text-muted">
          {items.length}/{maxItems} itens
        </span>
      </div>

      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, index) => (
            <li
              key={index}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <span className="flex-1 truncate">{item}</span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="shrink-0 text-muted hover:text-red-400 transition-colors"
                aria-label={`Remover "${item}"`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Adicionar item (máx. ${maxItemLength} caracteres)`}
          maxLength={maxItemLength}
          disabled={items.length >= maxItems}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleAdd}
          disabled={!newItem.trim() || items.length >= maxItems}
          className="shrink-0"
        >
          <Plus className="mr-1 h-4 w-4" />
          Adicionar
        </Button>
      </div>
    </div>
  );
}
