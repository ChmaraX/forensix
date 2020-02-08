import React, { useEffect, useState } from "react";
import {
  Grid,
  Segment,
  Header,
  Image,
  Icon,
  Flag,
  Button,
  Placeholder,
  Popup
} from "semantic-ui-react";
import "./Profile.css";
import axios from "axios";

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

const EstimatedContent = profile => (
  <div className="content">
    <Header subheader>{profile.fullname}</Header>
    <p className="left">
      <b>gender:</b> {profile.gender}{" "}
      <Icon
        title="test"
        name={profile.gender === "male" ? "man" : "woman"}
        color="blue"
      />
      <br />
      <b>nation:</b> {profile.country} <Flag name={profile.tld} /> <br />
      <b>birthday:</b> test <br />
    </p>
    <p className="right">
      <b>address:</b> {profile.address}
      <br />
      <b>credit card:</b> {profile.creditCard} <br />
    </p>
  </div>
);

const profileData = {
  fullname: "",
  country: "",
  tld: "",
  birthday: "",
  gender: "",
  address: "not found",
  creditCard: "not found",
  avatars: []
};

function Profile() {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(profileData);

  useEffect(() => {
    setLoading(true);
    axios.get("/profile/estimate").then(res => {
      setProfile({
        ...profile,
        fullname: res.data.fullname,
        country: res.data.nation.country,
        tld: res.data.nation.tld,
        birthday: res.data.birthday.birthday,
        gender: res.data.birthday.gender === 1 ? "male" : "female",
        avatars: res.data.avatars
      });
      setLoading(false);
    });
  }, []);

  return (
    <Segment className="profile" padded raised>
      {EstimatedHeader()}
      <Button size="tiny" style={{ float: "right" }}>
        Show accounts
      </Button>
      <Grid>
        <Grid.Row>
          <Grid.Column width={5}>
            {loading ? PlaceholderImage() : Avatar(profile.avatars[0])}
          </Grid.Column>
          <Grid.Column width={11}>
            {loading ? PlaceholderLine() : EstimatedContent(profile)}
          </Grid.Column>
        </Grid.Row>
      </Grid>
    </Segment>
  );
}

export default Profile;
