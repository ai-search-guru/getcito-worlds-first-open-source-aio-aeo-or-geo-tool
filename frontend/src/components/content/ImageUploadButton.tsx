'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { IMAGE_UPLOAD_ACCEPT, uploadContentImage } from '@/lib/content/imageUpload';
import { cn } from '@/lib/utils';

/**
 * Upload from your computer (00272): picks an image, uploads it, and hands
 * back its public address for the field beside it. Says why a file can't
 * go up (its type, its size, the plan, the day's uploads made, or the
 * upload failing).
 */
export function ImageUploadButton({
  onUploaded,
  className,
}: {
  onUploaded: (url: string) => void;
  className?: string;
}) {
  const t = useTranslations('content.imageUpload');
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const result = await uploadContentImage(file);
    setUploading(false);
    // The same file can be picked again after a failure.
    if (input.current) input.current.value = '';
    if ('error' in result) {
      toast.error(t(`errors.${result.error}`));
      return;
    }
    onUploaded(result.url);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        hidden
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn('gap-1.5', className)}
        disabled={uploading}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden className="h-3.5 w-3.5" />
        {uploading ? t('uploading') : t('button')}
      </Button>
    </>
  );
}
