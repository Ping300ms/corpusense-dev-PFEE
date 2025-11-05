import { useEffect, useState, type CSSProperties, ReactNode } from 'react';
import { CollectionDetails } from '@/data/models/Collection.ts';
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faFolder} from "@fortawesome/free-solid-svg-icons";
import { useDroppable } from '@dnd-kit/core';
import useAppNavigation from '@/hooks/useAppNavigation.tsx';

type MenuProps = { collection: CollectionDetails };

const Menu = ({collection}: MenuProps) => {
  const name = collection.name;
  const {setNodeRef, isOver} = useDroppable({
    id : collection.id,
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
        <span>{collection.name}</span>
      </div>
    </button>
  );
};

type ContextMenuProps = { children?: ReactNode, collection: CollectionDetails };

const ContextMenu = ({ collection }: ContextMenuProps) => {
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [clicked, setClicked] = useState(false);
  const [points, setPoints] = useState({
    x: 0,
    y: 0,
  });
  const navigation = useAppNavigation();


  useEffect(() => {
    const handleClick = () => setClicked(false);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, []);


  const handleOnModify = async () => {
    await navigation.goToCollectionInspector(collection.id);
  };

  const handleOpenCollection = async () => {
    await navigation.goToCollection(collection.id);
  };

  const handleDeleteCollection = () => {
    setSelectedCollections(selectedCollections.filter((collec) => collec !== collection.id));
  }

  return (
    <div style={{ ...contextMenuContainerStyle, left: points.x, top: points.y }} onDoubleClick={() => handleOpenCollection()}>
        <div
          key={collection.id}
          onContextMenu={(e) => {
            e.preventDefault();
            setClicked(true);
            setPoints({
              x: e.pageX,
              y: e.pageY,
            });
          }}
        >
          <Menu collection={collection} />
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
};

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

export default ContextMenu;