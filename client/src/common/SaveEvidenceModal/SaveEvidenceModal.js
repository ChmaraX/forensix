import React, { useState } from "react";
import { Header, Modal, Button, Icon, TextArea } from "semantic-ui-react";
import axios from "../../axios-api";

const token = localStorage.getItem("token");

const config = {
  headers: { Authorization: `Bearer ${token}` }
};

function SaveEvidenceModal(props) {
  const [description, setDescription] = useState();

  function saveEvidence() {
    let body = {
      data: props.showModal.data,
      description: description
    };
    axios.post("/evidences", body, config).then(res => {
      props.setShowModal({ show: false, data: {} });
    });
  }

  const handleChange = (e, { name, value }) => {
    setDescription(value);
  };

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
        <TextArea
          name="description"
          onChange={handleChange}
          placeholder="Describe the evidence record"
          style={{ minHeight: 100, width: "100%" }}
        />
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
