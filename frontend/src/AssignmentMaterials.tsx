import { FileAttachment } from './AttachmentPreview';
import { useCabinetResource } from './useCabinetResource';
import s from './assignment-materials.module.css';

type Material = {
  id: number; fileName: string; previewAvailable: boolean;
  senderName: string; recipientName: string; addedAt: string;
};

const timestamp = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
});

export function AssignmentMaterials({ assignmentId, teacher = false }: {
  assignmentId: number; teacher?: boolean;
}) {
  const { data, error } = useCabinetResource<Material[]>(`/assignments/${assignmentId}/materials`, 6000);
  if (error) return <p className={`muted ${s.section}`}>Материалы временно недоступны.</p>;
  if (!data?.length) return null;
  return <section className={s.section} aria-label="Материалы преподавателя">
    <h2>Материалы преподавателя</h2>
    <ul className={s.list}>{data.map(material => <li key={material.id}>
      <div className={s.file}>
        <FileAttachment fileName={material.fileName} previewAvailable={material.previewAvailable}
          previewPath={`/assignment-materials/${material.id}/preview`}
          downloadPath={`/api/assignment-materials/${material.id}/download`} />
      </div>
      <small>{teacher ? `Получатель · ${material.recipientName}` : material.senderName} ·{' '}
        <time dateTime={material.addedAt}>{timestamp.format(new Date(material.addedAt))} МСК</time>
      </small>
    </li>)}</ul>
  </section>;
}
