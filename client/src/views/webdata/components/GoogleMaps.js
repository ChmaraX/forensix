import React from "react";
import { Segment, Message } from "semantic-ui-react";
import { GoogleMap, LoadScript } from "@react-google-maps/api";

const center = {
  lat: 48.14816,
  lng: 17.10674
};

function GoogleMaps() {
  const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <Segment color="red" textAlign="center">
        <Message error>
          <Message.Header>Google Maps API Key Missing</Message.Header>
          <p>
            Please set <code>REACT_APP_GOOGLE_MAPS_API_KEY</code> in your environment variables.
            <br />
            Create a <code>.env</code> file in the client directory with:
            <br />
            <code>REACT_APP_GOOGLE_MAPS_API_KEY=your_api_key_here</code>
          </p>
        </Message>
      </Segment>
    );
  }

  return (
    <Segment color="blue" textAlign="center">
      <LoadScript
        id="script-loader"
        googleMapsApiKey={apiKey}
      >
        <GoogleMap
          id="data-example"
          mapContainerStyle={{
            height: "400px",
            width: "100%"
          }}
          zoom={13}
          center={center}
        />
      </LoadScript>
    </Segment>
  );
}

export default GoogleMaps;
