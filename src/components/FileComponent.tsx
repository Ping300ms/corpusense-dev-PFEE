import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFile } from '@fortawesome/free-solid-svg-icons';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';

type FileProps = {
  id: number | string;
  name: string;
};

function FileComponent({ id, name }: FileProps) {
  const {attributes, listeners, setNodeRef, transform} = useDraggable({
    id,
    data: { type: 'file', name }
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    cursor: 'grab'
  };

  return (
    <div style={collectionStyle}>
    <button ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <FontAwesomeIcon icon={faFile} style={{color: "#FFD43B"}} size="4x"/>
      <span>{name}</span>
    </button>
    </div>
  );
}

const collectionStyle: CSSProperties = {
  flexDirection: "column",
  display: "flex",
  padding: 30
}
export default FileComponent;