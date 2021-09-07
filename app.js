const axios = require("axios").default;
const fs = require("fs");
const sodium = require("tweetsodium");

/**
  The following is the nomenclature used in this file
  Nikshay19 -> Name of the the github organisation name (get it from config)
  Calculator -> Name of the repo -> This is the team_id
  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  -> This is the admin's authToken -> get it from config

**/

async function uploadTokenToRepoSecrets(arr) {
  for (const el of arr) {
    const { data: encKeyObject } = await axios.get(
      "https://api.github.com/repos/Nikshay19/Calculator/actions/secrets/public-key",
      {
        headers: {
          Authorization: `token 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`,
        },
      }
    );
    const encryptedValue = encryptTokenForRepoSecret(
      encKeyObject.key,
      el.value
    );
    await axios.put(
      `https://api.github.com/repos/Nikshay19/Calculator/actions/secrets/${el.token_name}`,
      {
        encrypted_value: encryptedValue,
        key_id: encKeyObject.key_id,
      },
      {
        headers: {
          Authorization: `token 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`,
        },
      }
    );
  }
  return "upload success";
}

async function linkTosonarCloud(
  sonarToken,
  gitHubOrganisation,
  repoName,
  sonarOrganisation,
  repoId,
  branch
) {
  const projectCreateReponse = await axios({
    url: "https://sonarcloud.io/api/alm_integration/provision_projects",
    method: "POST",
    auth: {
      username: sonarToken,
      password: "", // Password is not needed
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: `installationKeys=${gitHubOrganisation}%2F${repoName}%7C${repoId}&organization=${sonarOrganisation}`,
  });

  const triggerAutoScan = await axios.get(
    `https://sonarcloud.io/api/autoscan/eligibility?autoEnable=true&projectKey=${projectCreateReponse.data.projects[0].projectKey}`
  );
  console.log(triggerAutoScan.data);
  
  return projectCreateReponse;
}

async function pushBuildFile(path, gitHubOrganisation, repo, commitMessage) {
  let content = fs.readFileSync("build.yml", "base64");

  const response = await axios.put(
    `https://api.github.com/repos/${gitHubOrganisation}/${repo}/contents/${path}`,
    {
      owner: gitHubOrganisation,
      repo: repo,
      message: commitMessage,
      content: content,
    },
    {
      headers: {
        Authorization: `token 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`,
      },
    }
  );
  return response;
}

async function createSonarCloudProjectAndLinkToGitHub(
  sonarAuthToken,
  gitHubOrganisation,
  gitHubRepo,
  sonarOrganisation,
  branch
) {
  await uploadTokenToRepoSecrets([
    {
      value: sonarAuthToken,
      token_name: "SONAR_TOKEN",
    },
    {
      value: "1234rthjrthtr556",
      token_name: "git_repo_token",
    },
  ]);
  await pushBuildFile(
    ".github/workflows/build.yml",
    gitHubOrganisation,
    gitHubRepo,
    "build"
  );
  const { data } = await axios.get(
    `https://api.github.com/repos/${gitHubOrganisation}/${gitHubRepo}`
  );
  const respData = await linkTosonarCloud(
    sonarAuthToken,
    gitHubOrganisation,
    gitHubRepo,
    sonarOrganisation,
    data.id,
    branch
  );
    
  return respData;
}


async function fetchMetrics(projectKey){
 const metrics = await axios.get(
    `https://sonarcloud.io/api/measures/component_tree?component=${projectKey}&branch=${branch}&metricKeys=complexity,violations,bugs,code_smells,lines,vulnerabilities&additionalFields=metrics`
  );
  return metrics
}

createSonarCloudProjectAndLinkToGitHub(
  "f11d0b115fbdb7796f15a31aebe616f81654cb5e",
  "Nikshay19",
  "Customer-Log",
  "nikshay19",
  "main"
)
  .then((res) => {
    console.log(res.data);
    //Use only if needed  
    fetchMetrics(res.data.projects[0].projectKey)
  })
  .catch((err) => {
    console.log(err.response.data);
  });

function encryptTokenForRepoSecret(key, value) {
  const messageBytes = Buffer.from(value);
  const keyBytes = Buffer.from(key, "base64");

  const encryptedBytes = sodium.seal(messageBytes, keyBytes);

  const encrypted = Buffer.from(encryptedBytes).toString("base64");

  return encrypted;
}
