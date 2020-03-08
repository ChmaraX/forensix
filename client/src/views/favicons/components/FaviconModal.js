import React, { useState, useEffect } from "react";
import { Image, Modal, Button, Header, List } from "semantic-ui-react";
import axios from "axios";

function FaviconModal(props) {
  const [metadata, setMetadata] = useState();

  useEffect(() => {
    if (props.data.id) {
      axios.get(`/favicons/${props.data.id}`).then(res => {
        setMetadata(res.data);
      });
    }
  }, [props.data.id]);

  return (
    <Modal open={props.show} onClose={props.close} centered={false}>
      <Modal.Header>{props.data.url}</Modal.Header>
      <Modal.Content image>
        <Image wrapped src={props.data.url} />
        <Modal.Description>
          <Header>Favicon used on:</Header>
          <List animated>
            {metadata?.map(data => {
              return <List.Item as="a">{data.page_url}</List.Item>;
            })}
          </List>
        </Modal.Description>
      </Modal.Content>
    </Modal>
  );
}

export default FaviconModal;
