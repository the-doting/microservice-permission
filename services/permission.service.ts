import { ServiceSchema } from "../../../lib/types";

import DBMixin from "moleculer-db";
import SqlAdapter from "moleculer-db-adapter-sequelize";
import Sequelize from "sequelize";

import _ from "lodash";

(DBMixin as any).actions = {};

const Service: ServiceSchema = {
	name: "permission",
	version: "api.v1",

	/**
	 * Mixins
	 */
	mixins: [DBMixin],

	adapter: new SqlAdapter(process.env.DATABASE_URL || "sqlite://:memory:"),

	model: {
		name: "permission",
		define: {
			identity: {
				type: Sequelize.INTEGER,
			},
			service: {
				type: Sequelize.STRING, // service name who created the token and is responsible for it
			},
			permission: {
				type: Sequelize.STRING,
			},
			createdBy: {
				type: Sequelize.STRING,
			},
		},
	},

	/**
	 * Service settings
	 */
	settings: {},

	/**
	 * Service dependencies
	 */
	// dependencies: [],

	/**
	 * Actions
	 */
	actions: {
		give: {
			rest: "POST /give",
			params: {
				identity: {
					type: "number",
					min: 1,
					positive: true,
					integer: true,
				},
				service: {
					type: "string",
					min: 3,
				},
				permissions: {
					type: "array",
					items: "string",
					min: 1,
				},
				data: {
					type: "object",
					optional: true,
					default: {},
				},
			},
			async handler(ctx) {
				try {
					let { identity, service, permissions, data } = ctx.params;
					const creator = ctx.meta.creator.trim().toLowerCase();

					/**
					 * This algorithm is for handling every permissions in system.
					 * permission input: @admin:{user}:api.v1.admin
					 * permission output: from data we get { user: 1 } and we replace {user} with 1
					 * and we get @admin:1:api.v1.admin
					 */
					permissions = permissions.map((permission: string) => {
						const matches = permission.match(/\{([a-zA-Z0-9]+)\}/g);
						if (matches) {
							// replace all matches
							for (const match of matches) {
								const key = match.replace("{", "").replace("}", "");
								permission = permission.replace(match, data[key]);
							}
						}
						return permission;
					});

					let permissionsToGive: string[] = [...permissions];

					// check if identity exists
					const [resultCheckIdentity] = await this.adapter.db.query(
						`SELECT * FROM permissions WHERE identity = ${identity} AND service = '${service}' AND createdBy = '${creator}'`
					);

					if (resultCheckIdentity.length > 0) {
						// if permission exists, remove it from the list
						permissionsToGive = _.difference(
							permissions,
							resultCheckIdentity.map(
								(permission: any) => permission.permission
							)
						);
					}

					if (permissionsToGive.length == 0) {
						return {
							code: 400,
							i18n: "PERMISSIONS_ALREADY_GIVEN",
							data: {
								permissions,
							},
						};
					}

					// insert permissions
					await this.adapter.db.query(
						`INSERT INTO permissions (identity, service, permission, createdBy, createdAt, updatedAt) VALUES ${permissionsToGive
							.map(
								(permission: string) =>
									`(${identity}, '${service}', '${permission}', '${creator}', datetime('now'), datetime('now'))`
							)
							.join(", ")}`
					);

					return {
						code: 200,
						i18n: "PERMISSIONS_GIVEN",
						data: {
							permissions: permissionsToGive,
						},
					};
				} catch (error) {
					console.error(error);

					return {
						code: 500,
					};
				}
			},
		},
		lose: {
			rest: "DELETE /lose",
			params: {
				identity: {
					type: "number",
					min: 1,
				},
				service: {
					type: "string",
				},
				permissions: {
					type: "array",
					items: "string",
					min: 1,
				},
			},
			async handler(ctx) {
				try {
					const { identity, service, permissions } = ctx.params;
					const creator = ctx.meta.creator.trim().toLowerCase();

					// delete permissions
					await this.adapter.db.query(
						`DELETE FROM permissions WHERE identity = ${identity} AND service = '${service}' AND createdBy = '${creator}' AND permission IN (${permissions
							.map((permission: string) => `'${permission}'`)
							.join(", ")})`
					);

					return {
						code: 200,
						i18n: "PERMISSIONS_LOST",
						data: {
							permissions,
						},
					};
				} catch (error) {
					console.error(error);

					return {
						code: 500,
					};
				}
			},
		},
		has: {
			rest: "POST /has",
			params: {
				identity: {
					type: "number",
					min: 1,
				},
				service: {
					type: "string",
				},
				permissions: {
					type: "array",
					items: "string",
					min: 1,
				},
			},
			async handler(ctx) {
				try {
					const { identity, service, permissions } = ctx.params;
					const creator = ctx.meta.creator.trim().toLowerCase();

					// if permissions length is 1, SELECT one
					if (permissions.length == 1) {
						const [resultCheckIdentity] = await this.adapter.db.query(
							`SELECT * FROM permissions WHERE identity = ${identity} AND service = '${service}' AND createdBy = '${creator}' AND permission = '${permissions[0]}'`
						);

						return {
							code: 200,
							i18n: "PERMISSIONS_FOUND",
							data: {
								has: resultCheckIdentity.length > 0,
								permissions: [
									{
										has: resultCheckIdentity.length > 0,
										permission: permissions[0],
									},
								],
							},
						};
					}

					// check if identity exists
					const [resultCheckIdentity] = await this.adapter.db.query(
						`SELECT * FROM permissions WHERE identity = ${identity} AND service = '${service}' AND createdBy = '${creator}'`
					);

					let has = false;
					let checkedPermissions: any[] = permissions.map(
						(permission: string) => ({
							has: false,
							permission,
						})
					);

					if (resultCheckIdentity.length > 0) {
						const availablePermissions = resultCheckIdentity.map(
							(permission: any) => permission.permission
						);

						checkedPermissions = permissions.map((permission: string) => ({
							has: availablePermissions.includes(permission),
							permission,
						}));

						has = checkedPermissions.every((permission: any) => permission.has);
					}

					return {
						code: 200,
						i18n: "PERMISSIONS_FOUND",
						data: {
							has,
							permissions: checkedPermissions,
						},
					};
				} catch (error) {
					return {
						code: 500,
					};
				}
			},
		},
		getByIdentityAndService: {
			rest: "POST /get",
			params: {
				identity: {
					type: "number",
					min: 1,
				},
				service: {
					type: "string",
				},
			},
			async handler(ctx) {
				try {
					const { identity, service } = ctx.params;
					const creator = ctx.meta.creator.trim().toLowerCase();

					// check if identity exists
					const [resultCheckIdentity] = await this.adapter.db.query(
						`SELECT * FROM permissions WHERE identity = ${identity} AND service = '${service}' AND createdBy = '${creator}'`
					);

					return {
						code: 200,
						i18n: "PERMISSIONS_FOUND",
						meta: {
							total: resultCheckIdentity.length,
						},
						data: resultCheckIdentity.map(
							(permission: any) => permission.permission
						),
					};
				} catch (error) {
					return {
						code: 500,
					};
				}
			},
		},
	},

	/**
	 * Events
	 */
	events: {},

	/**
	 * Methods
	 */
	methods: {},

	/**
	 * Service created lifecycle event handler
	 */
	// created() {},

	/**
	 * Service started lifecycle event handler
	 */
	// started() { },

	/**
	 * Service stopped lifecycle event handler
	 */
	// stopped() { }
};

export = Service;
