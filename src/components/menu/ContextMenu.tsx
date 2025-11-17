import {type CSSProperties } from 'react';
import { CollectionDetails } from '@/data/models/Collection.ts';
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faFolder} from "@fortawesome/free-solid-svg-icons";
import { useDroppable } from '@dnd-kit/core';

type FolderProps = {
  id: string;
  name: string;
}
const ContextMenu = ({ folder }: { folder: FolderProps }) => {
  const name = folder.name;
  const {setNodeRef, isOver} = useDroppable({
    id : folder.id,
    data: { type: 'collection', name }
  });

  const style = {
    outline: isOver ? '2px solid #74C0FC' : 'none',
    outlineOffset: '2px'
  };

  return (
    <button ref={setNodeRef} style={style}>
      <div style={collectionStyle}>
        <FontAwesomeIcon icon={faFolder} style={{color: "#74C0FC"}} size="4x" />
        <span>{folder.name}</span>
      </div>
    </button>
  );
};

const collectionStyle: CSSProperties = {
  flexDirection: "column",
  display: "flex",
  padding: 30
}

export default ContextMenu;