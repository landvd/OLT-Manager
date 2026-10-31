// 自动更新版本清单的验签公钥（ADR-093）。私钥只保存在发布用的 Mac 上：~/.config/olt-manager/update-signing-key.pem
const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAHS+w/rokMZSwghCXd7UAnmZuETUOfg4AXJsm1h8faoM=
-----END PUBLIC KEY-----
`;

module.exports = { UPDATE_PUBLIC_KEY };
