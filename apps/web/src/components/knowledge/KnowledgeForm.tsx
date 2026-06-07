import { useState, useEffect } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import type { KnowledgeItem } from '@/types';

interface KnowledgeFormProps {
  item?: KnowledgeItem | null;
  onSave: (data: { category: string; title: string; content: string }) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

interface FormErrors {
  category?: string;
  title?: string;
  content?: string;
}

export function KnowledgeForm({ item, onSave, onCancel, isLoading }: KnowledgeFormProps) {
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    if (item) {
      setCategory(item.category);
      setTitle(item.title);
      setContent(item.content);
    } else {
      setCategory('');
      setTitle('');
      setContent('');
    }
    setErrors({});
  }, [item]);

  function validate(): boolean {
    const newErrors: FormErrors = {};

    if (!category.trim()) {
      newErrors.category = 'Categoria é obrigatória';
    } else if (category.length > 50) {
      newErrors.category = 'Categoria deve ter no máximo 50 caracteres';
    }

    if (!title.trim()) {
      newErrors.title = 'Título é obrigatório';
    } else if (title.length > 100) {
      newErrors.title = 'Título deve ter no máximo 100 caracteres';
    }

    if (!content.trim()) {
      newErrors.content = 'Conteúdo é obrigatório';
    } else if (content.length > 5000) {
      newErrors.content = 'Conteúdo deve ter no máximo 5000 caracteres';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    await onSave({
      category: category.trim(),
      title: title.trim(),
      content: content.trim(),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-border bg-card p-4">
      <h3 className="text-base font-semibold text-foreground">
        {item ? 'Editar item' : 'Novo item de conhecimento'}
      </h3>

      <div>
        <label className="mb-1 block text-sm text-muted">Categoria</label>
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Ex: empresa, servicos, automacao"
          maxLength={50}
          error={errors.category}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-muted">Título</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título do item"
          maxLength={100}
          error={errors.title}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-muted">Conteúdo</label>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Conteúdo da base de conhecimento"
          maxLength={5000}
          rows={5}
          error={errors.content}
        />
        <p className="mt-1 text-xs text-muted">{content.length}/5000</p>
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={isLoading}>
          Salvar
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
