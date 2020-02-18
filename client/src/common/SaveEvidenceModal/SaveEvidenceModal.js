import React from "react";
import { Header, Modal, Button, Icon } from "semantic-ui-react";

function SaveEvidenceModal(props) {

  function saveEvidence() {
    //todo hook to db
    props.setShowModal({ show: false, data: {} });
  }

  return (
    <Modal
      open={props.show}
      onClose={() => props.setShowModal({ show: false, data: {} })}
      basic
      size="small"
    >
      <Header
        icon="archive"
        content="Save selected history records as potential evidence?"
      />
      <Modal.Content>
        <p>
          Selected records will be stored in shared database with other
          investigators.
        </p>
      </Modal.Content>
      <Modal.Actions>
        <Button
          onClick={() => props.setShowModal({ show: false, data: {} })}
          basic
          color="red"
          inverted
        >
          <Icon name="remove" /> No
        </Button>
        <Button onClick={() => saveEvidence()} color="green" inverted>
          <Icon name="checkmark" /> Yes
        </Button>
      </Modal.Actions>
    </Modal>
  );
}

export default SaveEvidenceModal;
