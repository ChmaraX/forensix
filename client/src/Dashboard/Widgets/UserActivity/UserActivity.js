import React from "react";
import { Table, Segment, Header, Button, Image } from "semantic-ui-react";

const fakeData = [
  {
    name: "Adam Chmara",
    img: "stevie.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Marked history record as suspicious."
  },
  {
    name: "Daniel Lousie",
    img: "daniel.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Exported user activity as suspicious."
  },
  {
    name: "Elliot Fu",
    img: "elliot.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Marked website as potential evidence."
  },
  {
    name: "Adam Chmara",
    img: "stevie.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Exported user profile data."
  },
  {
    name: "Adam Chmara",
    img: "stevie.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Marked history record as suspicious."
  },
  {
    name: "Daniel Lousie",
    img: "daniel.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Exported user activity as suspicious."
  },
  {
    name: "Elliot Fu",
    img: "elliot.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Marked website as potential evidence."
  },
  {
    name: "Adam Chmara",
    img: "stevie.jpg",
    role: "Investigator",
    date: new Date(),
    action: "Exported user profile data."
  }
];

function UserActivity(props) {
  return (
    <Segment padded raised color="blue">
      <Header
        as="h1"
        content="Investigators Activity"
        subheader="last actions by all investigators on this volume"
        style={{ display: "inline-block" }}
      />
      <Button primary style={{ float: "right" }}>
        Show
      </Button>
      <Table celled fixed>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell width={4}>Name</Table.HeaderCell>
            <Table.HeaderCell>Date</Table.HeaderCell>
            <Table.HeaderCell>Action</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {fakeData.map(({ name, img, role, date, action, i }) => (
            <Table.Row key={i}>
              <Table.Cell>
                <Header as="h4" image>
                  <Image
                    src={
                      "https://react.semantic-ui.com/images/avatar/small/" + img
                    }
                    rounded
                    size="mini"
                  />
                  <Header.Content>
                    {name}
                    <Header.Subheader>{role}</Header.Subheader>
                  </Header.Content>
                </Header>
              </Table.Cell>
              <Table.Cell>{date.toDateString()}</Table.Cell>
              <Table.Cell>{action}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Segment>
  );
}

export default UserActivity;
