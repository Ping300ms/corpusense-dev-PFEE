import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFile } from '@fortawesome/free-solid-svg-icons';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CSSProperties, useEffect, useState } from 'react';
import useAppNavigation from '@/hooks/useAppNavigation.tsx';

type FileProps = {
  id: string;
  name: string;
};


const Menu = ({ collection }: { collection: FileProps }) => {
  const name = collection.name;
  const {attributes, listeners, setNodeRef, transform} = useDraggable({
    id: collection.id,
    data: { type: 'file', name }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    cursor: 'grab'
  };

  return (
    <div style={collectionStyle}>
      <button ref={setNodeRef} style={style} {...listeners} {...attributes}>
        <FontAwesomeIcon icon={faFile} style={{color: "#ffffff"}} size="4x"/>
        <span>{name}</span>
      </button>
    </div>
  );
};

function FileComponent(file: FileProps) {
  const navigation = useAppNavigation();
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [clicked, setClicked] = useState(false);
  const [points, setPoints] = useState({
    x: 0,
    y: 0,
  });

  useEffect(() => {
    const handleClick = () => setClicked(false);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, []);

  const handleOnModify = async () => {
    await navigation.goToCollectionInspector(file.id);
  };

  const handleOpenCollection = async () => {
    await navigation.goToCollection(file.id);
  };

  const handleDeleteCollection = () => {
    setSelectedCollections(selectedCollections.filter((collec) => collec !== collection.id));
  }


  return (
    <div style={{ ...contextMenuContainerStyle, left: points.x, top: points.y }} onDoubleClick={() => handleOpenCollection()}>
      <div
        key={file.id}
        onContextMenu={(e) => {
          e.preventDefault();
          setClicked(true);
          setPoints({
            x: e.pageX,
            y: e.pageY,
          });
        }}
      >
        <Menu collection={file} />
      </div>
      {clicked && (
        <div style={{ ...contextMenuItemStyle, left: points.x, top: points.y }}>
          <ul style={listStyle}>
            <li style={listItemStyle}>
              <button onClick={() => handleOpenCollection()}>Ouvrir</button></li>
            <li style={listItemStyle}><button onClick={() => handleOnModify()}>Modifier</button></li>
            <li style={listItemStyle}><button onClick={()=> handleDeleteCollection()}>Supprimer</button></li>
          </ul>
        </div>
      )}
    </div>
  );
}

const contextMenuContainerStyle: CSSProperties = {
  width: "50",
  border: "1px solid #ffffff2d",
  borderRadius: "4px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "row",
  alignItems: "flex-start",
}

const contextMenuItemStyle: CSSProperties = {
  width: '130px',
  backgroundColor: '#e1e1e1',
  border: '1px solid #ffffff2d',
  borderRadius: '4px',
  padding: '18px',
  margin: '5px 0',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
}

const listStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: 10,
  margin: 0,
  listStyle: 'none',
};

const listItemStyle: CSSProperties = {
  padding: '18px 12px',
};

const collectionStyle: CSSProperties = {
  flexDirection: "column",
  display: "flex",
  padding: 30
}
export default FileComponent;