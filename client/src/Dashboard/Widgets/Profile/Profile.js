import React, { useState } from "react";
import {
  Grid,
  Segment,
  Header,
  Image,
  Icon,
  Flag,
  Button,
  Placeholder,
  Popup,
  List
} from "semantic-ui-react";
import "./Profile.css";

const PlaceholderLine = () => (
  <Placeholder>
    <Placeholder.Line />
    <Placeholder.Line />
    <Placeholder.Line />
    <Placeholder.Line />
    <Placeholder.Line />
  </Placeholder>
);

const PlaceholderImage = () => (
  <Placeholder style={{ height: 150, width: 150 }}>
    <Placeholder.Image />
  </Placeholder>
);

const Avatar = avatar => (
  <Image
    circular
    style={{
      maxHeight: "150px"
    }}
    src={`data:image/png;base64, ${avatar}`}
  />
);

const EstimatedHeader = () => (
  <Header
    as="h1"
    content={
      <span>
        Profile <small style={{ color: "grey" }}>(estimated)</small>{" "}
        <Popup
          content="Estimation based on browsing history and login data."
          trigger={<Icon link name="help circle" size="small" color="grey" />}
        />
      </span>
    }
    style={{ display: "inline-block" }}
  />
);

const AccountsHeader = () => (
  <Header
    as="h1"
    content={
      <span>
        Accounts{" "}
        <Popup
          content="Existing user accounts used in Chrome (from Preferences file)."
          trigger={<Icon link name="help circle" size="small" color="grey" />}
        />
      </span>
    }
    style={{ display: "inline-block" }}
  />
);

const EstimatedContent = profile => (
  <div className="content">
    <Header subheader>{profile.fullname}</Header>
    <p className="left">
      <b>gender:</b> {profile.birthday.gender === 1 ? "male" : "female"}{" "}
      <Icon
        title="test"
        name={profile.birthday.gender === "male" ? "man" : "woman"}
        color="blue"
      />
      <br />
      <b>nation:</b> {profile.nation.country} <Flag name={profile.nation.tld} />{" "}
      <br />
      <b>birthday:</b> {profile.birthday.birthyear} <br />
    </p>
    <p className="right">
      <b>address:</b> {profile.address}
      <br />
      <b>credit card:</b> {profile.credit_card} <br />
    </p>
  </div>
);

const AccountContent = accounts => (
  <List style={{ overflowY: "scroll" }}>
    {accounts.map((acc, i) => (
      <List.Item key={i}>
        <Image avatar src={acc.picture_url} />
        <List.Content>
          <List.Header as="a">{acc.full_name}</List.Header>
          <List.Description>
            <p className="left">
              <b>email:</b> {acc.email} <br />
              <b>locale:</b> {acc.locale} <Flag name={acc.locale} /> <br />
            </p>
            <p className="right">
              <b>adv. protection:</b>{" "}
              {acc.is_under_advanced_protection.toString()} <br />
              <b>child account:</b> {acc.is_child_account.toString()} <br />
            </p>
          </List.Description>
        </List.Content>
      </List.Item>
    ))}
  </List>
);

function Profile(props) {
  const [showAccounts, setShowAccounts] = useState(false);

  return (
    <Segment className="profile" padded raised>
      {showAccounts ? AccountsHeader() : EstimatedHeader()}
      <Button
        onClick={() => setShowAccounts(!showAccounts)}
        size="tiny"
        style={{ float: "right" }}
      >
        {showAccounts ? "Show Profile" : "Show Accounts"}
      </Button>
      {showAccounts ? (
        props.loading ? (
          PlaceholderLine()
        ) : (
          AccountContent(props.accounts)
        )
      ) : (
        <Grid>
          <Grid.Row>
            <Grid.Column width={5}>
              {props.loading
                ? PlaceholderImage()
                : Avatar(props.profile.avatars[0])}
            </Grid.Column>
            <Grid.Column width={11}>
              {props.loading
                ? PlaceholderLine()
                : EstimatedContent(props.profile)}
            </Grid.Column>
          </Grid.Row>
        </Grid>
      )}
    </Segment>
  );
}

export default Profile;
